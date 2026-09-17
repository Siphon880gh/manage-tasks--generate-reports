import {
  COLUMN_TYPES, DEFAULT_COLUMNS, accountRole, applyDropOrder, availableColumnTypes, canAddColumnType,
  canEdit as userCanEdit, columnTypeToStatus, confirmDeleteMessage, filterTasks, formatMoment, plainText,
  reportRows, roleCaption, sortTasks, statusToColumnType, taskProgress, toCsv
} from "./app-core.mjs";
import {
  buildClickUpCsv, buildLedgerLaneBackup, buildNotionMarkdown, columnTypeForImport, importPreview, parseImport
} from "./import-export.mjs";

const DB_NAME = "ledgerlane-db";
const DB_VERSION = 2;
const ALLOWED_TAGS = new Set(["B", "STRONG", "I", "EM", "U", "P", "BR", "UL", "OL", "LI", "A", "IMG", "DIV", "SPAN", "H3"]);
const state = {
  user: null,
  users: [],
  tasks: [],
  projects: [],
  columns: [],
  view: "board",
  authMode: "signup",
  filters: { query: "", owner: "all", project: "all" },
  report: { type: "invoice", showDate: true, showTime: false, showDetails: true, projectIds: null },
  selection: new Set(),
  drag: { taskId: null, overColumnId: null, insertIndex: null },
  recording: { active: false, recorder: null, stream: null, chunks: [], taskId: null, startedAt: 0, timer: null },
  modalAttachments: [],
  suppressCardClick: false,
  pendingImport: null
};
const root = document.querySelector("#app");

const dbPromise = new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains("users")) db.createObjectStore("users", { keyPath: "id" }).createIndex("username", "username", { unique: true });
    if (!db.objectStoreNames.contains("tasks")) db.createObjectStore("tasks", { keyPath: "id" });
    if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
    if (!db.objectStoreNames.contains("columns")) db.createObjectStore("columns", { keyPath: "id" }).createIndex("projectId", "projectId");
    if (!db.objectStoreNames.contains("attachments")) db.createObjectStore("attachments", { keyPath: "id" }).createIndex("taskId", "taskId");
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function store(name, mode, action) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const request = action(tx.objectStore(name));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
const all = (name) => store(name, "readonly", (s) => s.getAll());
const put = (name, item) => store(name, "readwrite", (s) => s.put(item));
const remove = (name, id) => store(name, "readwrite", (s) => s.delete(id));
const attachmentsFor = (taskId) => store("attachments", "readonly", (s) => s.index("taskId").getAll(taskId));

const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]);
const initials = (name = "") => name.split(/\s+/).map((p) => p[0]).filter(Boolean).join("").slice(0, 2).toUpperCase();
const localDateTime = (iso) => iso ? new Date(iso).toISOString().slice(0, 16) : "";
const uuid = () => crypto.randomUUID();
const bytesLabel = (size = 0) => size > 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;

function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  [...doc.body.querySelectorAll("*")].forEach((el) => {
    if (!ALLOWED_TAGS.has(el.tagName)) el.replaceWith(...el.childNodes);
  });
  doc.body.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value || "";
      const hrefOk = el.tagName === "A" && name === "href" && /^(https?:|mailto:)/i.test(value);
      const imgOk = el.tagName === "IMG" && ((name === "src" && /^(https?:|data:image\/|blob:)/i.test(value)) || name === "alt");
      if (!hrefOk && !imgOk) el.removeAttribute(attr.name);
    });
  });
  return doc.body.innerHTML;
}

function toast(message) {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}

function askConfirm({ title, message, confirmLabel = "Delete permanently" }) {
  const dialog = document.querySelector("#confirm-dialog");
  document.querySelector("#confirm-title").textContent = title;
  document.querySelector("#confirm-message").textContent = message;
  document.querySelector("#confirm-ok").textContent = confirmLabel;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      resolve(value);
    };
    document.querySelector("#confirm-form").onsubmit = (event) => {
      event.preventDefault();
      finish(event.submitter?.value === "confirm");
    };
    dialog.onclose = () => finish(false);
    dialog.showModal();
  });
}

function canEdit() {
  return userCanEdit(state.user);
}

function guardEdit() {
  if (canEdit()) return true;
  toast("This account is view only");
  return false;
}

function columnsFor(projectId) {
  return state.columns.filter((column) => column.projectId === projectId).sort((a, b) => a.order - b.order);
}

function applyColumn(task, column) {
  task.columnId = column.id;
  task.status = columnTypeToStatus(column.type);
  task.completedAt = column.type === "complete" ? (task.completedAt || new Date().toISOString()) : null;
  return task;
}

async function createProjectRecord(name) {
  const project = { id: uuid(), name: name.trim(), createdAt: new Date().toISOString() };
  await put("projects", project);
  await Promise.all(DEFAULT_COLUMNS.map((column, order) => put("columns", {
    id: uuid(), projectId: project.id, name: column.name, type: column.type, order
  })));
  return project;
}

async function getOrCreateProject(name) {
  const existing = (await all("projects")).find((project) => project.name === name);
  return existing || createProjectRecord(name);
}

async function migrateWorkspace() {
  const needs = state.tasks.some((task) => !task.projectId || !task.columnId);
  if (!needs) return;
  for (const task of state.tasks) {
    if (task.projectId && task.columnId) continue;
    const project = await getOrCreateProject(task.project || "General");
    const columns = (await all("columns")).filter((column) => column.projectId === project.id);
    const column = columns.find((item) => item.type === statusToColumnType(task.status)) || columns[0];
    await put("tasks", {
      ...task,
      project: project.name,
      projectId: project.id,
      columnId: column.id,
      sortOrder: task.sortOrder ?? (Date.parse(task.createdAt) || 0)
    });
  }
  state.tasks = await all("tasks");
  state.projects = await all("projects");
  state.columns = await all("columns");
}

async function refresh() {
  state.users = await all("users");
  state.tasks = await all("tasks");
  state.projects = await all("projects");
  state.columns = await all("columns");
  const id = localStorage.getItem("ledgerlane-session");
  state.user = state.users.find((u) => u.id === id) || null;
  await migrateWorkspace();
  const valid = new Set(state.tasks.map((task) => task.id));
  state.selection = new Set([...state.selection].filter((taskId) => valid.has(taskId)));
  if (state.report.projectIds) {
    const known = new Set(state.projects.map((project) => project.id));
    state.report.projectIds = state.report.projectIds.filter((projectId) => known.has(projectId));
  }
  render();
}

function renderAuth(error = "") {
  root.innerHTML = `<main class="auth-page"><section class="auth-art"><div class="brand"><span class="brand-mark">LL</span> LEDGERLANE</div><h1>WORK,<br>ACCOUNTED<br>FOR.</h1><div><p class="statement">A local-first workspace for turning progress into proof — without sending your data anywhere.</p><p class="mono">PRIVATE BY DEFAULT / LOCAL BY DESIGN</p></div></section><section class="auth-card"><form id="auth-form"><div class="auth-tabs"><button type="button" data-auth="signup" class="${state.authMode === "signup" ? "active" : ""}">Create account</button><button type="button" data-auth="login" class="${state.authMode === "login" ? "active" : ""}">Sign in</button></div><p class="eyebrow">Local workspace</p><h2>${state.authMode === "signup" ? "Start your ledger." : "Welcome back."}</h2><p class="hint">Accounts live only in this browser on this computer.</p>${error ? `<p class="auth-error">${escapeHtml(error)}</p>` : ""}<div class="form" style="padding:24px 0">${state.authMode === "signup" ? `<div class="field"><label for="name">Display name</label><input id="name" name="name" required placeholder="e.g. Morgan Lee"></div>` : ""}<div class="field"><label for="username">Username</label><input id="username" name="username" required autocomplete="username" placeholder="morgan"></div><div class="field"><label for="password">Passphrase</label><input id="password" name="password" type="password" minlength="6" required autocomplete="${state.authMode === "signup" ? "new-password" : "current-password"}" placeholder="At least 6 characters"></div>${state.authMode === "signup" ? `<fieldset class="role-pick"><legend>Account type</legend><label class="mode-card" for="role-editor"><input id="role-editor" name="role" type="radio" value="editor" checked> <span>Editor<small>Create, move, and edit tasks. Default workspace role.</small></span></label><label class="mode-card" for="role-admin"><input id="role-admin" name="role" type="radio" value="admin"> <span>Admin<small>Full edit access, labeled Admin. Use for the Admin User test account.</small></span></label><label class="mode-card" for="role-viewer"><input id="role-viewer" name="role" type="radio" value="viewer"> <span>View only<small>See the Board and Reports. Cannot create, edit, move, or delete anything.</small></span></label></fieldset>` : ""}<button class="button primary" type="submit">${state.authMode === "signup" ? "Create local account →" : "Enter workspace →"}</button></div></form></section></main>`;
  document.querySelectorAll("[data-auth]").forEach((button) => button.onclick = () => { state.authMode = button.dataset.auth; renderAuth(); });
  document.querySelector("#auth-form").onsubmit = handleAuth;
}

async function handleAuth(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const username = data.get("username").trim().toLowerCase();
  const passwordHash = await hash(data.get("password"));
  if (state.authMode === "signup") {
    if (state.users.some((u) => u.username === username)) return renderAuth("That username already exists on this device.");
    const requested = String(data.get("role") || "editor");
    const role = requested === "admin" || requested === "viewer" ? requested : "editor";
    const user = { id: uuid(), name: data.get("name").trim(), username, passwordHash, role, createdAt: new Date().toISOString() };
    await put("users", user);
    if (role !== "viewer") {
      const existingTasks = await all("tasks");
      if (!existingTasks.length) await seedTasks(user);
    }
    localStorage.setItem("ledgerlane-session", user.id);
  } else {
    const user = state.users.find((u) => u.username === username && u.passwordHash === passwordHash);
    if (!user) return renderAuth("Username or passphrase did not match.");
    localStorage.setItem("ledgerlane-session", user.id);
  }
  await refresh();
}

async function hash(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function seedTasks(user) {
  const now = Date.now();
  const seeds = [
    ["Reconcile Q3 vendor receipts", "Finance ops", "high", "backlog", 2400, -6],
    ["Map approval workflow", "Finance ops", "medium", "backlog", 1200, -5],
    ["Implement billing summary", "Atlas rollout", "high", "progress", 4800, -4],
    ["Review stakeholder brief", "Atlas rollout", "medium", "progress", 900, -3],
    ["Close August retainers", "Client services", "low", "done", 3200, -8],
    ["Publish migration notes", "Atlas rollout", "medium", "done", 1800, -7]
  ];
  const cache = new Map();
  for (const [title, projectName, priority, status, rate, days] of seeds) {
    if (!cache.has(projectName)) cache.set(projectName, await getOrCreateProject(projectName));
    const project = cache.get(projectName);
    const columns = (await all("columns")).filter((column) => column.projectId === project.id);
    const column = columns.find((item) => item.type === statusToColumnType(status)) || columns[0];
    const createdAt = new Date(now + days * 86400000).toISOString();
    await put("tasks", {
      id: uuid(), title, project: project.name, projectId: project.id, columnId: column.id,
      priority, status, rate, ownerId: user.id, ownerName: user.name,
      description: "Seeded workspace task — edit or remove it at any time.",
      createdAt, completedAt: status === "done" ? new Date(now + (days + 2) * 86400000).toISOString() : null,
      timestampOverridden: false, sortOrder: now + days
    });
  }
}

function shell(content) {
  const role = accountRole(state.user);
  return `<div class="app-shell ${role === "viewer" ? "is-viewer" : ""}" data-role="${role}"><header class="topbar"><div class="brand"><span class="brand-mark">LL</span> LEDGERLANE</div><nav class="main-nav"><button class="nav-btn ${state.view === "board" ? "active" : ""}" data-view="board">Board</button><button class="nav-btn ${state.view === "reports" ? "active" : ""}" data-view="reports">Reports</button></nav><div class="account-area"><span class="account-name"><strong>${escapeHtml(state.user.name)}</strong><br><small class="mono">${escapeHtml(roleCaption(state.user))}</small></span><button class="avatar" id="account-button" title="Sign out">${initials(state.user.name)}</button></div></header>${content}<nav class="mobile-nav"><button class="${state.view === "board" ? "active" : ""}" data-view="board">▦ BOARD</button><button class="${state.view === "reports" ? "active" : ""}" data-view="reports">▤ REPORTS</button></nav></div>`;
}

function render() {
  if (!state.user) return renderAuth();
  root.innerHTML = shell(state.view === "board" ? boardView() : reportsView());
  document.querySelectorAll("[data-view]").forEach((button) => button.onclick = () => { state.view = button.dataset.view; render(); });
  document.querySelector("#account-button").onclick = async () => {
    if (await askConfirm({ title: "Sign out?", message: `Sign out ${state.user.name}? You can return with the same local passphrase.`, confirmLabel: "Sign out" })) {
      localStorage.removeItem("ledgerlane-session");
      state.user = null;
      state.view = "board";
      state.suppressCardClick = false;
      render();
    }
  };
  state.view === "board" ? bindBoard() : bindReports();
  bindActionMenus();
}

function visibleColumns() {
  if (state.filters.project === "all") {
    return COLUMN_TYPES.map((type) => ({ id: `type:${type.id}`, name: type.label, type: type.id, virtual: true }));
  }
  return columnsFor(state.filters.project);
}

function menuItem(id, title, hint, { danger = false } = {}) {
  return `<button type="button" class="menu-item ${danger ? "danger" : ""}" role="menuitem" id="${id}"><strong>${title}</strong>${hint ? `<small>${hint}</small>` : ""}</button>`;
}

function actionMenu(id, label, items) {
  return `<div class="menu" data-menu="${id}">
    <button type="button" class="button" data-menu-toggle id="${id}-toggle" aria-expanded="false" aria-haspopup="menu">${label} <span aria-hidden="true">▾</span></button>
    <div class="menu-panel" id="${id}-panel" role="menu" hidden>${items}</div>
  </div>`;
}

function boardView() {
  const visible = filterTasks(state.tasks, state.filters);
  const columns = visibleColumns();
  const selectedCount = [...state.selection].filter((id) => visible.some((task) => task.id === id)).length;
  const scopedProject = state.projects.find((project) => project.id === state.filters.project);
  const addTypes = scopedProject ? availableColumnTypes(columnsFor(scopedProject.id)) : [];
  const edit = canEdit();
  return `<main class="main">
    <header class="page-head">
      <div><p class="eyebrow">Workspace / Delivery board</p><h1>Move the work.<br><em>Keep the proof.</em></h1></div>
      <div class="page-actions">${edit ? `
        <div class="action-cluster" aria-label="Create">
          <button class="button" id="new-project" type="button">New project</button>
          <button class="button acid" id="new-task" type="button">New task</button>
        </div>
        <div class="action-divider" aria-hidden="true"></div>
        ${actionMenu("board-menu", "More actions", [
          menuItem("import-tasks", "Import tasks", "Add work from ClickUp or a LedgerLane file"),
          menuItem("export-tasks", "Export…", "Copy for Notion, ClickUp CSV, or a LedgerLane backup"),
          `<hr>`,
          menuItem("record-board", "Record screen", "Capture your display and attach the video to a task"),
          `<hr>`,
          menuItem("delete-all-tasks", "Delete all visible tasks…", "Removes everything matching the filters", { danger: true })
        ].join(""))}` : `
        <p class="viewer-pill" id="viewer-banner">View only — editing is off</p>
        <button class="button" id="export-tasks" type="button">Copy for Notion</button>`}
      </div>
    </header>
    <section class="toolbar" aria-label="Board filters">
      <input class="search" id="search" value="${escapeHtml(state.filters.query)}" placeholder="⌕ Search tasks or projects…">
      <select class="select" id="owner-filter"><option value="all">All owners</option>${state.users.map((u) => `<option value="${u.id}" ${state.filters.owner === u.id ? "selected" : ""}>${escapeHtml(u.name)}</option>`).join("")}</select>
      <select class="select" id="project-filter"><option value="all">All projects</option>${state.projects.map((p) => `<option value="${p.id}" ${state.filters.project === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}</select>
      ${edit ? `<label class="toolbar-select check-line"><input type="checkbox" id="select-all" ${visible.length && selectedCount === visible.length ? "checked" : ""}> Select</label>` : ""}
    </section>
    ${edit ? `<section class="selection-bar" id="selection-bar" ${selectedCount ? "" : "hidden"} aria-label="Selected tasks">
      <span class="selection-count" id="selection-count">${selectedCount} selected</span>
      <button class="button" id="delete-selected" type="button" ${selectedCount ? "" : "disabled"}>Delete selected</button>
      <button class="button ghost" id="clear-selection" type="button">Clear</button>
    </section>` : ""}
    <section class="kanban">${columns.map((column) => columnMarkup(column, visible)).join("")}${edit && scopedProject ? addColumnMarkup(addTypes) : ""}</section>
    ${scopedProject && edit ? "" : scopedProject ? "" : `<p class="hint board-hint">${edit ? "Select one project to rename columns or add custom ones. Complete stays a single column type." : "You can browse every project. Nothing here can be changed from this account."}</p>`}
  </main>${taskDialog()}`;
}

function columnMarkup(column, visible) {
  const tasks = sortTasks(visible.filter((task) => column.virtual ? task.status === columnTypeToStatus(column.type) : task.columnId === column.id));
  const typeLabel = COLUMN_TYPES.find((item) => item.id === column.type)?.label || column.type;
  const title = column.virtual || !canEdit()
    ? `<h2>${escapeHtml(column.name)}</h2>`
    : `<label class="column-title-wrap"><span class="visually-hidden">Rename column</span><input class="column-title" data-rename="${column.id}" value="${escapeHtml(column.name)}" aria-label="Column name"></label>`;
  return `<div class="column" data-drop="${column.id}" data-column-type="${column.type}">
    <header class="column-head">
      ${title}
      <span class="column-meta"><span class="count">${tasks.length}</span><span class="column-type">${escapeHtml(typeLabel)}</span></span>
    </header>
    <div class="card-list">${tasks.length ? tasks.map(taskCard).join("") : `<div class="empty">${canEdit() ? "Drop work here" : "No work here"}</div>`}</div>
  </div>`;
}

function addColumnMarkup(types) {
  return `<div class="add-column" id="add-column-panel">
    <button class="button" id="add-column-toggle" type="button">＋ Add column</button>
    <form id="add-column-form" hidden>
      <label class="field"><span>Column name</span><input name="name" required placeholder="e.g. Review" maxlength="40"></label>
      <label class="field"><span>Column type</span><select name="type">${types.map((type) => `<option value="${type.id}">${escapeHtml(type.label)}${type.unique ? " (only one)" : ""}</option>`).join("")}</select></label>
      ${types.length ? "" : `<p class="hint">Only the Complete type is unique — this project already has one.</p>`}
      <button class="button primary" type="submit" ${types.length ? "" : "disabled"}>Add column</button>
    </form>
  </div>`;
}

function taskCard(task) {
  const selected = state.selection.has(task.id);
  const clip = (task.attachmentCount || 0) > 0 ? `<span class="clip" title="Has attachments">▣</span>` : "";
  return `<article class="task-card ${selected ? "is-selected" : ""}" ${canEdit() ? `draggable="true"` : ""} data-id="${task.id}" tabindex="0">
    <div class="card-top">
      ${canEdit() ? `<label class="task-check"><input type="checkbox" data-select="${task.id}" ${selected ? "checked" : ""} aria-label="Select ${escapeHtml(task.title)}"></label>` : ""}
      <span class="tag ${task.priority}">${escapeHtml(task.priority)} priority</span>
    </div>
    <h3>${escapeHtml(task.title)}</h3>
    <p class="project">${escapeHtml(task.project)}</p>
    <footer class="card-meta">
      <span class="mini-avatar">${initials(task.ownerName)}</span>
      <span>${task.status === "done" ? "Done " : "Created "}${formatMoment(task.status === "done" ? task.completedAt : task.createdAt, { showDate: true })}${task.timestampOverridden ? " · ✎" : ""}${clip}</span>
    </footer>
  </article>`;
}

function taskDialog() {
  const projectOptions = state.projects.map((project) => `<option value="${project.id}">${escapeHtml(project.name)}</option>`).join("");
  const locked = !canEdit();
  const lock = locked ? "disabled" : "";
  return `<dialog id="task-dialog" class="task-dialog ${locked ? "is-readonly" : ""}">
    <form id="task-form">
      <input type="hidden" name="id">
      <header class="task-dialog-head">
        <div class="task-chip-row">
          <label class="chip-field"><span>Status</span><select name="columnId" ${lock}></select></label>
          <label class="chip-field"><span>Project</span><span class="chip-combo"><select name="projectId" ${lock}>${projectOptions}</select>${locked ? "" : `<button class="chip-add" type="button" id="task-new-project" title="New project" aria-label="New project">＋</button>`}</span></label>
          <label class="chip-field"><span>Priority</span><select name="priority" ${lock}><option>low</option><option selected>medium</option><option>high</option></select></label>
          <label class="chip-field"><span>Owner</span><select name="ownerId" ${lock}>${state.users.map((u) => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join("")}</select></label>
        </div>
        <button class="icon-button" type="button" id="close-dialog" aria-label="Close">×</button>
      </header>
      <div class="task-dialog-body">
        <label class="title-field"><span class="visually-hidden">Task title</span><input name="title" required placeholder="Task name" ${lock}></label>
        <div class="rtf">
          ${locked ? "" : `<div class="rtf-toolbar" role="toolbar" aria-label="Description formatting">
            <button type="button" data-cmd="bold" title="Bold"><strong>B</strong></button>
            <button type="button" data-cmd="italic" title="Italic"><em>I</em></button>
            <button type="button" data-cmd="underline" title="Underline"><u>U</u></button>
            <button type="button" data-cmd="insertUnorderedList" title="Bulleted list">• List</button>
            <button type="button" data-cmd="insertOrderedList" title="Numbered list">1. List</button>
          </div>`}
          <div class="rtf-editor" id="task-description" contenteditable="${locked ? "false" : "true"}" role="textbox" aria-label="Description" data-placeholder="Write the brief, paste screenshots, or drop evidence…"></div>
        </div>
        <section class="attach-panel" id="attach-panel">
          <header class="attach-head">
            <h3>Attachments</h3>
            ${locked ? "" : `<div class="attach-actions">${actionMenu("attach-menu", "Add files", `
              <label class="menu-item" id="attach-files-label" role="menuitem"><strong>Attach from computer</strong><small>Images, video, or documents</small><input type="file" id="attach-files" multiple hidden></label>
              ${menuItem("record-screen", "Record screen", "Capture the display and attach the video")}
            `)}</div>`}
          </header>
          <p class="hint">${locked ? "Files attached to this task." : "Drop files here, or paste images into the description."}</p>
          <ul class="attach-list" id="attach-list"></ul>
        </section>
        <details class="advanced-options" id="advanced-options">
          <summary>Advanced options</summary>
          <div class="form-grid">
            <div class="field"><label>Created date &amp; time</label><input type="datetime-local" name="createdAt" required ${lock}></div>
            <div class="field"><label>Completed date &amp; time</label><input type="datetime-local" name="completedAt" ${lock}></div>
          </div>
          <p class="hint">✎ Changing these timestamps marks this task as manually adjusted in reports.</p>
          <div class="field"><label>Settlement amount (USD)</label><input type="number" min="0" step="1" name="rate" placeholder="0" ${lock}></div>
        </details>
      </div>
      <footer class="form-actions">
        ${locked ? "" : `<button class="button ghost danger" type="button" id="delete-task" hidden>Delete</button>`}
        <button class="button" type="button" id="cancel-task">${locked ? "Close" : "Cancel"}</button>
        ${locked ? "" : `<button class="button primary" type="submit">Save task</button>`}
      </footer>
    </form>
  </dialog>`;
}

function bindBoard() {
  state.suppressCardClick = false;
  const dialog = document.querySelector("#task-dialog");
  document.querySelector("#search").oninput = (event) => { state.filters.query = event.target.value; render(); document.querySelector("#search").focus(); };
  document.querySelector("#owner-filter").onchange = (event) => { state.filters.owner = event.target.value; render(); };
  document.querySelector("#project-filter").onchange = (event) => { state.filters.project = event.target.value; render(); };
  document.querySelector("#close-dialog").onclick = document.querySelector("#cancel-task").onclick = () => closeTaskDialog();
  document.querySelectorAll(".task-card").forEach((card) => {
    card.onclick = () => { if (!state.suppressCardClick) openTask(card.dataset.id); };
    card.onkeydown = (event) => { if (event.key === "Enter") openTask(card.dataset.id); };
  });
  if (!canEdit()) {
    document.querySelector("#export-tasks").onclick = () => openNotionExport();
    bindTaskEditor(dialog, true);
    return;
  }
  document.querySelector("#new-task").onclick = () => openTask();
  document.querySelector("#new-project").onclick = () => openProjectPrompt({ switchFilter: true });
  document.querySelector("#import-tasks").onclick = () => openImportDialog();
  document.querySelector("#export-tasks").onclick = () => openExportDialog();
  document.querySelector("#record-board").onclick = () => startRecording(null);
  document.querySelector("#task-form").onsubmit = saveTask;
  document.querySelector("#delete-task").onclick = deleteOpenTask;
  document.querySelector("#task-new-project").onclick = () => openProjectPrompt({ fromTask: true });
  document.querySelector("#select-all").onchange = (event) => {
    const visible = filterTasks(state.tasks, state.filters);
    if (event.target.checked) visible.forEach((task) => state.selection.add(task.id));
    else visible.forEach((task) => state.selection.delete(task.id));
    render();
  };
  document.querySelector("#delete-selected").onclick = () => deleteTasks([...state.selection], "from the selection");
  document.querySelector("#clear-selection").onclick = () => { state.selection.clear(); render(); };
  document.querySelector("#delete-all-tasks").onclick = deleteAllVisible;
  document.querySelectorAll(".task-check").forEach((label) => {
    label.onclick = (event) => event.stopPropagation();
    label.onpointerdown = (event) => event.stopPropagation();
  });
  document.querySelectorAll("[data-select]").forEach((box) => {
    box.onclick = (event) => event.stopPropagation();
    box.onchange = (event) => {
      event.stopPropagation();
      if (box.checked) state.selection.add(box.dataset.select);
      else state.selection.delete(box.dataset.select);
      syncSelectionChrome();
    };
  });
  document.querySelectorAll(".task-card").forEach((card) => {
    card.ondragstart = (event) => {
      state.suppressCardClick = true;
      card.classList.add("dragging");
      state.drag.taskId = card.dataset.id;
      event.dataTransfer.setData("text/plain", card.dataset.id);
      event.dataTransfer.effectAllowed = "move";
    };
    card.ondragend = () => {
      card.classList.remove("dragging");
      clearDropCues();
      state.drag = { taskId: null, overColumnId: null, insertIndex: null };
      setTimeout(() => { state.suppressCardClick = false; }, 0);
    };
  });
  bindColumnDrag();
  bindColumnEdits();
  bindTaskEditor(dialog, false);
}

function syncSelectionChrome() {
  const visible = filterTasks(state.tasks, state.filters);
  const selected = [...state.selection].filter((id) => visible.some((task) => task.id === id));
  const count = document.querySelector("#selection-count");
  const del = document.querySelector("#delete-selected");
  const allBox = document.querySelector("#select-all");
  const bar = document.querySelector("#selection-bar");
  if (count) count.textContent = `${selected.length} selected`;
  if (del) del.disabled = !selected.length;
  if (bar) bar.hidden = selected.length === 0;
  if (allBox) allBox.checked = visible.length > 0 && selected.length === visible.length;
  document.querySelectorAll(".task-card").forEach((card) => card.classList.toggle("is-selected", state.selection.has(card.dataset.id)));
}

function closeActionMenus() {
  document.querySelectorAll("[data-menu]").forEach((menu) => {
    const panel = menu.querySelector(".menu-panel");
    const toggle = menu.querySelector("[data-menu-toggle]");
    if (panel) panel.hidden = true;
    toggle?.setAttribute("aria-expanded", "false");
  });
}

function bindActionMenus() {
  document.querySelectorAll("[data-menu]").forEach((menu) => {
    const toggle = menu.querySelector("[data-menu-toggle]");
    const panel = menu.querySelector(".menu-panel");
    if (!toggle || !panel) return;
    toggle.onclick = (event) => {
      event.stopPropagation();
      const willOpen = panel.hidden;
      closeActionMenus();
      if (willOpen) {
        panel.hidden = false;
        toggle.setAttribute("aria-expanded", "true");
      }
    };
  });
}

function bindColumnDrag() {
  document.querySelectorAll("[data-drop]").forEach((column) => {
    column.ondragover = (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const list = column.querySelector(".card-list");
      const cards = [...list.querySelectorAll(".task-card:not(.dragging)")];
      let index = cards.length;
      for (let i = 0; i < cards.length; i += 1) {
        const rect = cards[i].getBoundingClientRect();
        if (event.clientY < rect.top + rect.height / 2) { index = i; break; }
      }
      if (state.drag.overColumnId === column.dataset.drop && state.drag.insertIndex === index && list.querySelector(".drop-slot")) {
        column.classList.add("is-drop-target");
        return;
      }
      state.drag.overColumnId = column.dataset.drop;
      state.drag.insertIndex = index;
      document.querySelectorAll(".is-drop-target").forEach((el) => el.classList.remove("is-drop-target"));
      document.querySelectorAll(".drop-slot").forEach((el) => el.remove());
      column.classList.add("is-drop-target");
      const empty = list.querySelector(".empty");
      if (empty) empty.remove();
      const slot = document.createElement("div");
      slot.className = "drop-slot";
      slot.textContent = "Drop here";
      if (index >= cards.length) list.appendChild(slot);
      else list.insertBefore(slot, cards[index]);
    };
    column.ondragleave = (event) => {
      if (!column.contains(event.relatedTarget)) {
        column.classList.remove("is-drop-target");
        column.querySelectorAll(".drop-slot").forEach((el) => el.remove());
      }
    };
    column.ondrop = async (event) => {
      event.preventDefault();
      const id = event.dataTransfer.getData("text/plain") || state.drag.taskId;
      const insertIndex = state.drag.insertIndex ?? 0;
      clearDropCues();
      await moveTask(id, column.dataset.drop, insertIndex);
    };
  });
}

function clearDropCues() {
  document.querySelectorAll(".is-drop-target").forEach((el) => el.classList.remove("is-drop-target"));
  document.querySelectorAll(".drop-slot").forEach((el) => el.remove());
}

function resolveDropColumn(dropId, task) {
  if (dropId.startsWith("type:")) {
    const type = dropId.slice(5);
    return columnsFor(task.projectId).find((column) => column.type === type) || columnsFor(task.projectId)[0];
  }
  return state.columns.find((column) => column.id === dropId);
}

async function moveTask(taskId, dropId, insertIndex) {
  if (!guardEdit()) return;
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const dest = resolveDropColumn(dropId, task);
  if (!dest) return;
  applyColumn(task, dest);
  const visible = filterTasks(state.tasks, state.filters);
  const visual = sortTasks(visible.filter((item) => {
    if (item.id === taskId) return false;
    return dropId.startsWith("type:") ? item.status === columnTypeToStatus(dropId.slice(5)) : item.columnId === dest.id;
  }));
  const neighbor = visual[Math.min(insertIndex, visual.length)];
  const inColumn = sortTasks(state.tasks.filter((item) => item.id !== taskId && item.columnId === dest.id));
  const destIndex = neighbor && neighbor.columnId === dest.id ? inColumn.findIndex((item) => item.id === neighbor.id) : inColumn.length;
  const reindexed = applyDropOrder([...inColumn, task], task.id, destIndex < 0 ? inColumn.length : destIndex);
  await Promise.all(reindexed.map((item) => put("tasks", item)));
  toast("Task moved");
  await refresh();
}

function bindColumnEdits() {
  document.querySelectorAll("[data-rename]").forEach((input) => {
    input.onclick = (event) => event.stopPropagation();
    input.onchange = async () => {
      if (!guardEdit()) return;
      const column = state.columns.find((item) => item.id === input.dataset.rename);
      const name = input.value.trim();
      if (!column || !name || name === column.name) return;
      column.name = name;
      await put("columns", column);
      toast("Column renamed");
    };
  });
  const toggle = document.querySelector("#add-column-toggle");
  const form = document.querySelector("#add-column-form");
  if (!toggle || !form) return;
  toggle.onclick = () => { form.hidden = !form.hidden; if (!form.hidden) form.elements.name.focus(); };
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (!guardEdit()) return;
    const projectId = state.filters.project;
    const existing = columnsFor(projectId);
    const type = form.elements.type.value;
    const name = form.elements.name.value.trim();
    if (!name || !canAddColumnType(existing, type)) return;
    await put("columns", { id: uuid(), projectId, name, type, order: existing.length });
    toast("Column added");
    await refresh();
  };
}

async function openProjectPrompt({ switchFilter = false, fromTask = false } = {}) {
  if (!guardEdit()) return;
  const dialog = document.querySelector("#project-dialog");
  const form = document.querySelector("#project-form");
  form.reset();
  const finish = (project) => {
    dialog.close();
    return project;
  };
  document.querySelector("#close-project").onclick = document.querySelector("#cancel-project").onclick = () => finish(null);
  form.onsubmit = async (event) => {
    event.preventDefault();
    const name = form.elements.name.value.trim();
    if (!name) return;
    const project = await createProjectRecord(name);
    state.projects = await all("projects");
    state.columns = await all("columns");
    if (Array.isArray(state.report.projectIds)) state.report.projectIds.push(project.id);
    toast("Project created");
    dialog.close();
    if (fromTask) {
      const select = document.querySelector("#task-form")?.elements.projectId;
      if (select) {
        select.insertAdjacentHTML("beforeend", `<option value="${project.id}" selected>${escapeHtml(project.name)}</option>`);
        select.value = project.id;
        fillColumnSelect(project.id);
      }
      return;
    }
    if (switchFilter) state.filters.project = project.id;
    await refresh();
  };
  dialog.showModal();
  form.elements.name.focus();
}

function fillColumnSelect(projectId, selectedId) {
  const select = document.querySelector("#task-form")?.elements.columnId;
  if (!select) return;
  const columns = columnsFor(projectId);
  select.innerHTML = columns.map((column) => `<option value="${column.id}">${escapeHtml(column.name)}</option>`).join("");
  if (selectedId && columns.some((column) => column.id === selectedId)) select.value = selectedId;
}

function bindTaskEditor(dialog, readOnly = false) {
  const form = document.querySelector("#task-form");
  const editor = document.querySelector("#task-description");
  dialog.addEventListener("close", () => revokeModalUrls(), { once: true });
  if (readOnly) return;
  form.elements.projectId.onchange = () => fillColumnSelect(form.elements.projectId.value);
  document.querySelectorAll("[data-cmd]").forEach((button) => {
    button.onclick = (event) => {
      event.preventDefault();
      editor.focus();
      document.execCommand(button.dataset.cmd, false);
    };
  });
  editor.onpaste = async (event) => {
    const image = [...(event.clipboardData?.items || [])].find((item) => item.type.startsWith("image/"));
    if (!image) return;
    event.preventDefault();
    await ingestFile(image.getAsFile(), { embed: true });
  };
  editor.ondragover = (event) => event.preventDefault();
  editor.ondrop = async (event) => {
    event.preventDefault();
    await Promise.all([...event.dataTransfer.files].map((file) => ingestFile(file, { embed: file.type.startsWith("image/") })));
  };
  const panel = document.querySelector("#attach-panel");
  panel.ondragover = (event) => { event.preventDefault(); panel.classList.add("is-drop"); };
  panel.ondragleave = () => panel.classList.remove("is-drop");
  panel.ondrop = async (event) => {
    event.preventDefault();
    panel.classList.remove("is-drop");
    await Promise.all([...event.dataTransfer.files].map((file) => ingestFile(file)));
  };
  document.querySelector("#attach-files").onchange = async (event) => {
    await Promise.all([...event.target.files].map((file) => ingestFile(file)));
    event.target.value = "";
  };
  document.querySelector("#record-screen").onclick = () => startRecording(form.elements.id.value || "draft");
}

function closeTaskDialog() {
  document.querySelector("#task-dialog").close();
  revokeModalUrls();
  state.modalAttachments = [];
}

function revokeModalUrls() {
  state.modalAttachments.forEach((item) => { if (item.url) URL.revokeObjectURL(item.url); });
}

async function openTask(id) {
  try {
    if (!id && !guardEdit()) return;
    const dialog = document.querySelector("#task-dialog");
    const form = document.querySelector("#task-form");
    const field = (name) => form?.elements.namedItem(name) || form?.querySelector(`[name="${name}"]`);
    const task = state.tasks.find((item) => item.id === id);
    if (!task && !canEdit()) return;
    const projectId = task?.projectId || (state.filters.project !== "all" ? state.filters.project : state.projects[0]?.id);
    if (!projectId) {
      if (!guardEdit()) return;
      toast("Create a project first");
      return openProjectPrompt({ switchFilter: true });
    }
    form.reset();
    field("id").value = task?.id || "";
    field("title").value = task?.title || "";
    field("projectId").value = projectId;
    fillColumnSelect(projectId, task?.columnId);
    field("ownerId").value = task?.ownerId || state.user.id;
    field("priority").value = task?.priority || "medium";
    field("createdAt").value = localDateTime(task?.createdAt || new Date().toISOString());
    field("completedAt").value = localDateTime(task?.completedAt);
    field("rate").value = task?.rate || "";
    const editor = document.querySelector("#task-description");
    const raw = task?.description || "";
    editor.innerHTML = /<[a-z][\s\S]*>/i.test(raw) ? sanitizeHtml(raw) : escapeHtml(raw);
    document.querySelector("#advanced-options").open = false;
    const deleteBtn = document.querySelector("#delete-task");
    if (deleteBtn) deleteBtn.hidden = !task;
    revokeModalUrls();
    dialog.showModal();
    if (canEdit()) field("title").focus();
    state.modalAttachments = task ? (await attachmentsFor(task.id)).map((item) => ({ ...item, url: URL.createObjectURL(item.blob) })) : [];
    renderAttachList();
  } catch (error) {
    toast(error.message);
    document.querySelector("#task-dialog")?.setAttribute("data-open-error", error.message);
  }
}

function renderAttachList() {
  const list = document.querySelector("#attach-list");
  if (!list) return;
  if (!state.modalAttachments.length) {
    list.innerHTML = `<li class="attach-empty">No files yet</li>`;
    return;
  }
  list.innerHTML = state.modalAttachments.map((item) => {
    const media = item.mime.startsWith("image/")
      ? `<img src="${item.url}" alt="">`
      : item.mime.startsWith("video/")
        ? `<video src="${item.url}" controls></video>`
        : `<div class="file-chip">${escapeHtml(item.mime.split("/")[1] || "file")}</div>`;
    return `<li class="attach-item" data-att="${item.id}">${media}<div><strong>${escapeHtml(item.name)}</strong><small>${bytesLabel(item.size)}</small></div><div class="attach-item-actions"><a class="button" href="${item.url}" download="${escapeHtml(item.name)}">Download</a>${canEdit() ? `<button type="button" class="button ghost danger" data-remove-att="${item.id}">Remove</button>` : ""}</div></li>`;
  }).join("");
  list.querySelectorAll("[data-remove-att]").forEach((button) => {
    button.onclick = () => removeAttachment(button.dataset.removeAtt);
  });
}

async function ingestFile(file, { embed = false } = {}) {
  if (!guardEdit()) return;
  if (!file) return;
  const record = {
    id: uuid(),
    taskId: document.querySelector("#task-form")?.elements.id.value || "draft",
    name: file.name || `paste-${Date.now()}`,
    mime: file.type || "application/octet-stream",
    size: file.size,
    createdAt: new Date().toISOString(),
    blob: file,
    url: URL.createObjectURL(file)
  };
  state.modalAttachments.push(record);
  const taskId = document.querySelector("#task-form")?.elements.id.value;
  if (taskId) await put("attachments", { id: record.id, taskId, name: record.name, mime: record.mime, size: record.size, createdAt: record.createdAt, blob: record.blob });
  renderAttachList();
  if (embed && record.mime.startsWith("image/")) {
    document.querySelector("#task-description").focus();
    document.execCommand("insertImage", false, record.url);
  }
  toast(file.type.startsWith("video/") ? "Recording attached" : "File attached");
}

async function removeAttachment(id) {
  if (!guardEdit()) return;
  const item = state.modalAttachments.find((att) => att.id === id);
  state.modalAttachments = state.modalAttachments.filter((att) => att.id !== id);
  if (item?.url) URL.revokeObjectURL(item.url);
  if (item && item.taskId !== "draft") await remove("attachments", id);
  renderAttachList();
}

async function saveTask(event) {
  event.preventDefault();
  if (!guardEdit()) return;
  const data = new FormData(event.currentTarget);
  const old = state.tasks.find((task) => task.id === data.get("id"));
  const owner = state.users.find((user) => user.id === data.get("ownerId"));
  const project = state.projects.find((item) => item.id === data.get("projectId"));
  const column = state.columns.find((item) => item.id === data.get("columnId"));
  if (!owner || !project || !column) return;
  const createdAt = new Date(data.get("createdAt")).toISOString();
  const completedAt = data.get("completedAt") ? new Date(data.get("completedAt")).toISOString() : (column.type === "complete" ? (old?.completedAt || new Date().toISOString()) : null);
  const description = sanitizeHtml(document.querySelector("#task-description").innerHTML);
  const task = {
    id: old?.id || uuid(),
    title: data.get("title").trim(),
    project: project.name,
    projectId: project.id,
    columnId: column.id,
    ownerId: owner.id,
    ownerName: owner.name,
    status: columnTypeToStatus(column.type),
    priority: data.get("priority"),
    description,
    rate: Number(data.get("rate")) || 0,
    createdAt,
    completedAt,
    timestampOverridden: old ? old.createdAt !== createdAt || old.completedAt !== completedAt || old.timestampOverridden : createdAt.slice(0, 16) !== new Date().toISOString().slice(0, 16),
    sortOrder: old?.sortOrder ?? Date.now()
  };
  await put("tasks", task);
  await Promise.all(state.modalAttachments.map((item) => put("attachments", {
    id: item.id, taskId: task.id, name: item.name, mime: item.mime, size: item.size, createdAt: item.createdAt, blob: item.blob
  })));
  closeTaskDialog();
  toast(old ? "Task updated" : "Task created");
  await refresh();
}

async function deleteOpenTask() {
  const id = document.querySelector("#task-form").elements.id.value;
  if (!id) return;
  await deleteTasks([id], "this task");
}

async function deleteAllVisible() {
  closeActionMenus();
  const visible = filterTasks(state.tasks, state.filters);
  const project = state.projects.find((item) => item.id === state.filters.project);
  const scope = state.filters.project === "all" ? "in this workspace" : `in ${project?.name || "this project"}`;
  await deleteTasks(visible.map((task) => task.id), scope, "Delete all tasks?");
}

async function deleteTasks(ids, scopeLabel, title = "Delete tasks?") {
  if (!guardEdit()) return;
  const unique = [...new Set(ids)].filter(Boolean);
  if (!unique.length) return;
  const ok = await askConfirm({ title, message: confirmDeleteMessage(unique.length, scopeLabel === "this task" ? "" : scopeLabel) });
  if (!ok) return;
  for (const id of unique) {
    const attached = await attachmentsFor(id);
    await Promise.all(attached.map((item) => remove("attachments", item.id)));
    await remove("tasks", id);
    state.selection.delete(id);
  }
  document.querySelector("#task-dialog")?.close();
  toast(unique.length === 1 ? "Task deleted" : `${unique.length} tasks deleted`);
  await refresh();
}

function includedProjectIds() {
  if (!state.report.projectIds) return state.projects.map((project) => project.id);
  return state.report.projectIds;
}

function reportsView() {
  const labels = { invoice: ["Invoice settlement", "Completed work prepared for settlement."], project: ["Project manager", "Delivery detail, owners, and operational status."], stakeholder: ["Stakeholder pulse", "A concise outcome-oriented portfolio view."] };
  const [title, subtitle] = labels[state.report.type];
  const selected = includedProjectIds();
  const rows = reportRows(state.tasks, state.report.type, { projectIds: selected });
  const total = rows.reduce((sum, task) => sum + Number(task.rate || 0), 0);
  const projects = new Set(rows.map((task) => task.project)).size;
  return `<main class="main">
    <header class="page-head"><div><p class="eyebrow">Workspace / Reports</p><h1>Turn progress<br>into <em>proof.</em></h1></div></header>
    <section class="report-layout">
      <aside class="report-controls">
        <h3>Report lens</h3>
        <div class="report-types">${Object.entries(labels).map(([id, [label]]) => `<button class="report-type ${state.report.type === id ? "active" : ""}" data-report="${id}">${label}</button>`).join("")}</div>
        <h3>Projects</h3>
        <div class="seg" role="group" aria-label="Project selection"><button type="button" class="seg-btn" id="report-all-projects">All</button><button type="button" class="seg-btn" id="report-no-projects">None</button></div>
        <div class="project-checks" id="report-projects">${state.projects.map((project) => `<label class="check-line"><input type="checkbox" data-report-project="${project.id}" ${selected.includes(project.id) ? "checked" : ""}> ${escapeHtml(project.name)}</label>`).join("") || `<p class="hint">No projects yet.</p>`}</div>
        <h3>Display controls</h3>
        ${[["showDate", "Show dates"], ["showTime", "Show exact times"], ["showDetails", "Task detail"]].map(([key, label]) => `<div class="switch-row"><span>${label}</span><button aria-label="Toggle ${label}" class="switch ${state.report[key] ? "on" : ""}" data-toggle="${key}"><span></span></button></div>`).join("")}
        <p class="hint" style="margin-top:22px">Invoice reports default to dates without exact times. Adjustments apply instantly.</p>
      </aside>
      <article class="report-sheet">
        <header class="report-sheet-head">
          <div><p class="mono">LEDGERLANE / ${new Date().getFullYear()}</p><h2>${title}</h2><p>${subtitle}</p></div>
          <div class="report-actions">${actionMenu("report-share", "Share", [
            menuItem("download-report", "Download CSV", "A spreadsheet of the rows on this report"),
            menuItem("print-report", "Print", "Open the print dialog for this sheet")
          ].join(""))}</div>
        </header>
        <div class="stats">
          <div class="stat"><strong>${rows.length}</strong><small>Items shown</small></div>
          <div class="stat"><strong>${taskProgress(rows)}%</strong><small>Completion</small></div>
          <div class="stat"><strong>${state.report.type === "invoice" ? `$${total.toLocaleString()}` : projects}</strong><small>${state.report.type === "invoice" ? "Settlement" : "Projects"}</small></div>
        </div>
        ${rows.length ? `<table><thead><tr><th>Work item</th><th>Owner</th>${state.report.showDate || state.report.showTime ? "<th>Reported</th>" : ""}<th>Result</th></tr></thead><tbody>${rows.map((task) => `<tr><td><strong>${escapeHtml(task.title)}</strong>${state.report.showDetails ? `<br><small>${escapeHtml(task.project)}${plainText(task.description) ? ` — ${escapeHtml(plainText(task.description))}` : ""}${task.timestampOverridden ? " · ✎ adjusted" : ""}</small>` : ""}</td><td>${escapeHtml(task.ownerName)}</td>${state.report.showDate || state.report.showTime ? `<td>${formatMoment(task.completedAt || task.createdAt, state.report)}</td>` : ""}<td>${escapeHtml(task.result)}</td></tr>`).join("")}</tbody></table>` : `<div class="empty">No work matches this report yet. ${selected.length ? "" : "Select at least one project."}</div>`}
      </article>
    </section>
  </main>`;
}

function bindReports() {
  document.querySelectorAll("[data-report]").forEach((button) => button.onclick = () => {
    state.report.type = button.dataset.report;
    if (button.dataset.report === "invoice") state.report.showTime = false;
    render();
  });
  document.querySelectorAll("[data-toggle]").forEach((button) => button.onclick = () => {
    state.report[button.dataset.toggle] = !state.report[button.dataset.toggle];
    render();
  });
  document.querySelectorAll("[data-report-project]").forEach((box) => box.onchange = () => {
    state.report.projectIds = [...document.querySelectorAll("[data-report-project]:checked")].map((item) => item.dataset.reportProject);
    render();
  });
  document.querySelector("#report-all-projects").onclick = () => { state.report.projectIds = state.projects.map((project) => project.id); render(); };
  document.querySelector("#report-no-projects").onclick = () => { state.report.projectIds = []; render(); };
  document.querySelector("#print-report").onclick = () => { closeActionMenus(); print(); };
  document.querySelector("#download-report").onclick = () => {
    closeActionMenus();
    const rows = reportRows(state.tasks, state.report.type, { projectIds: includedProjectIds() });
    const columns = [
      { label: "Task", value: (row) => row.title },
      { label: "Project", value: (row) => row.project },
      { label: "Owner", value: (row) => row.ownerName },
      ...(state.report.showDate || state.report.showTime ? [{ label: "Reported", value: (row) => formatMoment(row.completedAt || row.createdAt, state.report) }] : []),
      { label: "Result", value: (row) => row.result }
    ];
    const blob = new Blob([toCsv(rows, columns)], { type: "text/csv" });
    const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `ledgerlane-${state.report.type}.csv` });
    link.click();
    URL.revokeObjectURL(link.href);
    toast("Report downloaded");
  };
}

async function startRecording(taskId) {
  closeActionMenus();
  if (!guardEdit()) return;
  if (state.recording.active) return toast("Already recording");
  if (!navigator.mediaDevices?.getDisplayMedia) return toast("Screen recording is not available in this browser");
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
    const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type)) || "";
    const chunks = [];
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    state.recording = { active: true, recorder, stream, chunks, taskId, startedAt: Date.now(), timer: null };
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => finishRecording();
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      state.recording.keep = true;
      if (recorder.state !== "inactive") recorder.stop();
    });
    recorder.start();
    setHud(true);
    toast("Recording screen");
  } catch (error) {
    if (error.name !== "NotAllowedError") toast("Could not start screen recording");
  }
}

function formatRecordTime(ms) {
  const elapsed = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
}

function setHud(on) {
  const hud = document.querySelector("#record-hud");
  const clock = document.querySelector("#record-hud-time");
  hud.hidden = !on;
  document.body.classList.toggle("is-recording", on);
  clearInterval(state.recording.timer);
  state.recording.timer = null;
  if (!on) {
    if (clock) clock.textContent = "0:00";
    return;
  }
  const tick = () => {
    if (clock) clock.textContent = formatRecordTime(Date.now() - (state.recording.startedAt || Date.now()));
  };
  tick();
  state.recording.timer = setInterval(tick, 1000);
}

function stopRecording(save) {
  const { recorder, stream } = state.recording;
  state.recording.keep = save;
  stream?.getTracks().forEach((track) => track.stop());
  if (recorder && recorder.state !== "inactive") recorder.stop();
  else finishRecording();
}

async function finishRecording() {
  const { chunks, taskId, keep } = state.recording;
  setHud(false);
  state.recording = { active: false, recorder: null, stream: null, chunks: [], taskId: null, keep: false, startedAt: 0, timer: null };
  if (!keep || !chunks?.length) return;
  const blob = new Blob(chunks, { type: chunks[0]?.type || "video/webm" });
  const file = new File([blob], `ledgerlane-recording-${Date.now()}.webm`, { type: blob.type });
  if (taskId === "draft" || document.querySelector("#task-dialog")?.open) {
    await ingestFile(file);
    return;
  }
  if (taskId) {
    await attachBlobToTask(taskId, file);
    return;
  }
  if (state.selection.size === 1) {
    await attachBlobToTask([...state.selection][0], file);
    return;
  }
  await chooseRecordTarget(file);
}

async function attachBlobToTask(taskId, file) {
  await put("attachments", {
    id: uuid(), taskId, name: file.name, mime: file.type, size: file.size, createdAt: new Date().toISOString(), blob: file
  });
  toast("Recording attached");
}

async function chooseRecordTarget(file) {
  const dialog = document.querySelector("#record-target-dialog");
  const select = document.querySelector("#record-target-task");
  select.innerHTML = state.tasks.map((task) => `<option value="${task.id}">${escapeHtml(task.title)} · ${escapeHtml(task.project)}</option>`).join("");
  if (!state.tasks.length) {
    toast("Create a task to attach this recording");
    return;
  }
  const close = () => dialog.close();
  document.querySelector("#close-record-target").onclick = document.querySelector("#cancel-record-target").onclick = close;
  document.querySelector("#record-target-form").onsubmit = async (event) => {
    event.preventDefault();
    await attachBlobToTask(select.value, file);
    close();
  };
  dialog.showModal();
}

function downloadBlob(filename, blob) {
  const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: filename });
  link.click();
  URL.revokeObjectURL(link.href);
}

function stamp(name) {
  return `${name}-${new Date().toISOString().slice(0, 10)}`;
}

function openImportDialog() {
  closeActionMenus();
  if (!guardEdit()) return;
  state.pendingImport = null;
  const form = document.querySelector("#import-form");
  form.reset();
  document.querySelector("#import-preview").textContent = "Choose a file to preview how many tasks will come in.";
  document.querySelector("#confirm-import").disabled = true;
  document.querySelector("#import-dialog").showModal();
}

function updateImportPreview() {
  const preview = document.querySelector("#import-preview");
  const parsed = state.pendingImport;
  const mode = document.querySelector("#import-form")?.elements.mode.value || "append";
  const button = document.querySelector("#confirm-import");
  if (!parsed?.tasks.length) {
    preview.textContent = parsed ? "No tasks found in that file." : "Choose a file to preview how many tasks will come in.";
    button.disabled = true;
    return;
  }
  const info = importPreview(parsed, state.tasks.length, mode);
  preview.textContent = `${info.formatLabel}: ${info.incoming} task${info.incoming === 1 ? "" : "s"} across ${info.projects} list${info.projects === 1 ? "" : "s"}. ${mode === "replace" ? `Replace will leave ${info.nextCount}` : `Append will bring the board to ${info.nextCount}`}.`;
  button.disabled = false;
}

async function handleImportFile(event) {
  const file = event.target.files?.[0];
  if (!file) { state.pendingImport = null; updateImportPreview(); return; }
  try {
    const text = await file.text();
    state.pendingImport = parseImport(text, file.name);
    updateImportPreview();
  } catch (error) {
    state.pendingImport = null;
    document.querySelector("#import-preview").textContent = `Could not read that file: ${error.message}`;
    document.querySelector("#confirm-import").disabled = true;
  }
}

function matchOwner(name) {
  if (!name) return state.user;
  return state.users.find((user) => user.name.toLowerCase() === name.toLowerCase()) || state.user;
}

async function ensureImportColumn(project, draft) {
  const columns = columnsFor(project.id);
  const wantedName = (draft.columnName || draft.statusLabel || "").trim();
  if (wantedName) {
    const byName = columns.find((column) => column.name.toLowerCase() === wantedName.toLowerCase());
    if (byName) return byName;
  }
  const type = columnTypeForImport(draft);
  const typeColumn = columns.find((column) => column.type === type);
  const generic = /^(to do|todo|to-do|in progress|in-progress|progress|complete|completed|done|open|closed)$/i.test(wantedName);
  if (!wantedName || generic) return typeColumn || columns[0];
  if (type === "complete" && !canAddColumnType(columns, "complete")) return typeColumn || columns[0];
  const column = { id: uuid(), projectId: project.id, name: wantedName, type, order: columns.length };
  await put("columns", column);
  state.columns.push(column);
  return column;
}

async function wipeAllTasks() {
  for (const task of [...state.tasks]) {
    const attached = await attachmentsFor(task.id);
    await Promise.all(attached.map((item) => remove("attachments", item.id)));
    await remove("tasks", task.id);
    state.selection.delete(task.id);
  }
}

async function applyImport(parsed, mode) {
  if (mode === "replace") await wipeAllTasks();
  let created = 0;
  for (const draft of parsed.tasks) {
    const project = await getOrCreateProject(draft.project || "Imported");
    state.projects = await all("projects");
    state.columns = await all("columns");
    const column = await ensureImportColumn(project, draft);
    const owner = matchOwner(draft.ownerName);
    const createdAt = draft.createdAt || new Date().toISOString();
    const completedAt = column.type === "complete" ? (draft.completedAt || new Date().toISOString()) : null;
    await put("tasks", {
      id: uuid(),
      title: draft.title,
      project: project.name,
      projectId: project.id,
      columnId: column.id,
      ownerId: owner.id,
      ownerName: draft.ownerName || owner.name,
      status: columnTypeToStatus(column.type),
      priority: draft.priority || "medium",
      description: sanitizeHtml(draft.description || ""),
      rate: Number(draft.rate) || 0,
      createdAt,
      completedAt,
      timestampOverridden: Boolean(draft.timestampOverridden),
      sortOrder: Date.now() + created,
      externalId: draft.externalId || ""
    });
    created += 1;
  }
  return created;
}

async function submitImport(event) {
  event.preventDefault();
  if (!guardEdit()) return;
  const parsed = state.pendingImport;
  const mode = event.currentTarget.elements.mode.value;
  if (!parsed?.tasks.length) return;
  if (mode === "replace") {
    const ok = await askConfirm({
      title: "Replace all tasks?",
      message: `This deletes ${state.tasks.length} current task${state.tasks.length === 1 ? "" : "s"}, then imports ${parsed.tasks.length}. This cannot be undone.`,
      confirmLabel: "Replace tasks"
    });
    if (!ok) return;
  }
  const count = await applyImport(parsed, mode);
  document.querySelector("#import-dialog").close();
  state.pendingImport = null;
  toast(mode === "replace" ? `Replaced board with ${count} imported task${count === 1 ? "" : "s"}` : `Appended ${count} imported task${count === 1 ? "" : "s"}`);
  await refresh();
}

function closeExportDialog() {
  const dialog = document.querySelector("#export-dialog");
  if (dialog?.open) dialog.close();
}

function openExportDialog() {
  closeActionMenus();
  if (!canEdit()) return openNotionExport();
  document.querySelector("#export-dialog").showModal();
}

function exportClickUp() {
  if (!guardEdit()) return;
  const csv = buildClickUpCsv(state.tasks, { columns: state.columns });
  downloadBlob(`${stamp("clickup-tasks")}.csv`, new Blob([csv], { type: "text/csv" }));
  closeExportDialog();
  toast("ClickUp CSV downloaded");
}

function exportLedgerLane() {
  if (!guardEdit()) return;
  const backup = buildLedgerLaneBackup({ projects: state.projects, columns: state.columns, tasks: state.tasks });
  downloadBlob(`${stamp("ledgerlane-backup")}.json`, new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
  closeExportDialog();
  toast("LedgerLane backup downloaded");
}

function openNotionExport() {
  const visible = filterTasks(state.tasks, state.filters);
  const text = buildNotionMarkdown(visible, { projects: state.projects, columns: state.columns });
  const area = document.querySelector("#notion-text");
  area.value = text;
  closeActionMenus();
  closeExportDialog();
  document.querySelector("#notion-dialog").showModal();
  area.focus();
  area.select();
}

async function copyNotionText() {
  const area = document.querySelector("#notion-text");
  const text = area?.value || "";
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      area.focus();
      area.select();
      document.execCommand("copy");
    }
    toast("Copied — paste into Notion");
  } catch {
    area.focus();
    area.select();
    toast("Select the text and copy it");
  }
}

function bindGlobalChrome() {
  document.querySelector("#stop-recording").onclick = () => stopRecording(true);
  document.querySelector("#cancel-recording").onclick = () => stopRecording(false);
  document.querySelector("#close-import").onclick = document.querySelector("#cancel-import").onclick = () => document.querySelector("#import-dialog").close();
  document.querySelector("#import-file").onchange = handleImportFile;
  document.querySelector("#import-form").onsubmit = submitImport;
  document.querySelector("#import-form").onchange = (event) => {
    if (event.target.name === "mode") updateImportPreview();
  };
  document.querySelector("#close-export").onclick = document.querySelector("#cancel-export").onclick = () => closeExportDialog();
  document.querySelector("#export-notion").onclick = () => openNotionExport();
  document.querySelector("#export-clickup").onclick = exportClickUp;
  document.querySelector("#export-ledgerlane").onclick = exportLedgerLane;
  document.querySelector("#close-notion").onclick = document.querySelector("#cancel-notion").onclick = () => document.querySelector("#notion-dialog").close();
  document.querySelector("#copy-notion").onclick = copyNotionText;
  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-menu]")) closeActionMenus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeActionMenus();
  });
}

bindGlobalChrome();
refresh().catch((error) => { root.innerHTML = `<p class="auth-error">Unable to open local storage: ${escapeHtml(error.message)}</p>`; });
