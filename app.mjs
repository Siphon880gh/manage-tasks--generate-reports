import {
  BOARD_ROLES, CARD_COLORS, COLUMN_TYPES, DEFAULT_COLUMNS, applyDropOrder, availableColumnTypes, availableColumnTypesForEdit,
  boardFiltersActive, boardRole, canAccessBoard, canAddColumnType, canAssignRole, canDeleteColumn, canEditBoard,
  canManagePeople, canRemoveMember, columnTypeToStatus, confirmDeleteColumnMessage, confirmDeleteMessage,
  destinationAfterColumnDelete, blocksForSlot, defaultLinkLabel, emptyBoardFilters, emptyReportLayouts, filterTasks,
  engagementCashAmount, engagementIsCashSettlement, engagementTermsLabel, engagementWorkTimingLabel, findTagByName,
  formatMoment, googleWorkspaceKind, invitableUsers, memberFor, naturalJoin, nextReportBlockOrder,
  normalizeBoardRole, cardColorMeta, normalizeCardColor, normalizeEngagementTerms, normalizeHttpUrl, normalizeReportBlocks, normalizeTagIds, normalizeTagName,
  plainText, reindexReportBlocks, reportBlockHasContent, REPORT_SLOTS, reportRows, roleCaption, seedMemberships, sortTasks,
  statusToColumnType, taskProgress, toCsv, toggleListValue
} from "./app-core.mjs";
import {
  buildClickUpCsv, buildLedgerLaneBackup, buildNotionMarkdown, columnTypeForImport, importPreview, parseImport
} from "./import-export.mjs";

const DB_NAME = "ledgerlane-db";
const DB_VERSION = 6;
const REPORT_IMAGE_MAX = 6 * 1024 * 1024;
const ALLOWED_TAGS = new Set(["B", "STRONG", "I", "EM", "U", "P", "BR", "UL", "OL", "LI", "A", "IMG", "DIV", "SPAN", "H3"]);
const state = {
  user: null,
  users: [],
  members: [],
  tasks: [],
  projects: [],
  engagements: [],
  engagementTasks: [],
  columns: [],
  tags: [],
  view: "board",
  authMode: "signup",
  filters: emptyBoardFilters(),
  report: { type: "invoice", showDate: true, showTime: false, showDetails: true, projectIds: null },
  reportLayouts: emptyReportLayouts(),
  reportEditing: false,
  reportFocusBlockId: null,
  selection: new Set(),
  drag: { taskId: null, overColumnId: null, insertIndex: null },
  recording: { active: false, recorder: null, stream: null, chunks: [], taskId: null, startedAt: 0, timer: null },
  modalAttachments: [],
  suppressCardClick: false,
  openCardMenu: null,
  cardMenuFocus: false,
  pendingImport: null,
  boardStructure: false,
  structureRestoreAll: false,
  activeEngagementId: null
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
    if (!db.objectStoreNames.contains("members")) db.createObjectStore("members", { keyPath: "id" }).createIndex("userId", "userId", { unique: true });
    if (!db.objectStoreNames.contains("reportLayouts")) db.createObjectStore("reportLayouts", { keyPath: "id" });
    if (!db.objectStoreNames.contains("tags")) db.createObjectStore("tags", { keyPath: "id" });
    if (!db.objectStoreNames.contains("engagements")) db.createObjectStore("engagements", { keyPath: "id" });
    if (!db.objectStoreNames.contains("engagementTasks")) db.createObjectStore("engagementTasks", { keyPath: "id" }).createIndex("engagementId", "engagementId");
  };
  request.onsuccess = () => {
    const db = request.result;
    db.onversionchange = () => db.close();
    resolve(db);
  };
  request.onblocked = () => {
    if (root && !root.innerHTML) root.innerHTML = `<p class="auth-error">This workspace is updating local storage. Close other LedgerLane tabs, then refresh.</p>`;
  };
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
const usd = (amount) => `$${Number(amount || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

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
      const linkMeta = el.tagName === "A" && (
        (name === "target" && value === "_blank")
        || name === "rel"
        || (name === "class" && /^report-link-(docs|drive)$/.test(value))
      );
      const imgOk = el.tagName === "IMG" && ((name === "src" && /^(https?:|data:image\/|blob:)/i.test(value)) || name === "alt");
      if (!hrefOk && !linkMeta && !imgOk) el.removeAttribute(attr.name);
    });
  });
  return doc.body.innerHTML;
}

let reportSaveTimer = 0;
let reportLinkContext = { editor: null, range: null };

function prepareReportHtml(html) {
  const box = document.createElement("div");
  box.innerHTML = sanitizeHtml(html);
  box.querySelectorAll("a[href]").forEach((anchor) => {
    const raw = anchor.getAttribute("href") || "";
    if (/^mailto:/i.test(raw)) return;
    const href = normalizeHttpUrl(raw);
    if (!href) {
      anchor.replaceWith(...anchor.childNodes);
      return;
    }
    anchor.setAttribute("href", href);
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
    const kind = googleWorkspaceKind(href);
    anchor.classList.remove("report-link-docs", "report-link-drive");
    if (kind === "docs") anchor.classList.add("report-link-docs");
    if (kind === "drive") anchor.classList.add("report-link-drive");
  });
  return box.innerHTML;
}

function currentReportLayout(type = state.report.type) {
  if (!state.reportLayouts[type]) state.reportLayouts[type] = { id: type, blocks: [] };
  return state.reportLayouts[type];
}

function visibleReportType() {
  return document.querySelector(".report-sheet")?.dataset.reportType || state.report.type;
}

function flushReportEditors() {
  const editors = document.querySelectorAll("[data-report-block]");
  if (!editors.length) return false;
  const layout = currentReportLayout(visibleReportType());
  let changed = false;
  editors.forEach((editor) => {
    const block = layout.blocks.find((item) => item.id === editor.dataset.reportBlock);
    if (!block) return;
    const html = sanitizeHtml(editor.innerHTML);
    if (block.html !== html) {
      block.html = html;
      changed = true;
    }
  });
  return changed;
}

function captureReportEditor(editor) {
  const layout = currentReportLayout(visibleReportType());
  const block = layout.blocks.find((item) => item.id === editor.dataset.reportBlock);
  if (block) block.html = editor.innerHTML;
}

function scheduleReportSave() {
  clearTimeout(reportSaveTimer);
  reportSaveTimer = setTimeout(() => { persistReportLayout(); }, 400);
}

async function persistReportLayout(type = visibleReportType()) {
  const layout = currentReportLayout(type);
  layout.blocks = reindexReportBlocks(layout.blocks);
  await put("reportLayouts", { id: type, blocks: layout.blocks });
}

async function loadReportLayouts() {
  const stored = await all("reportLayouts");
  const next = emptyReportLayouts();
  for (const row of stored) {
    if (!next[row.id]) continue;
    next[row.id] = { id: row.id, blocks: normalizeReportBlocks(row.blocks) };
  }
  state.reportLayouts = next;
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
  return canEditBoard(state.user, state.members);
}

function guardEdit() {
  if (canEdit()) return true;
  toast("This account is view only on this board");
  return false;
}

function guardManage() {
  if (canManagePeople(state.user, state.members)) return true;
  toast("Only a board admin can manage people");
  return false;
}

function currentBoardRole() {
  return boardRole(state.user, state.members);
}

function boardPeople() {
  return state.members.map((member) => {
    const user = state.users.find((item) => item.id === member.userId);
    return user ? { member, user, name: user.name } : null;
  }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

function memberUsers() {
  const ids = new Set(state.members.map((member) => member.userId));
  return state.users.filter((user) => ids.has(user.id));
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

async function createProjectRecord(name, metadata = {}) {
  const project = { id: uuid(), name: name.trim(), createdAt: new Date().toISOString(), ...metadata };
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

async function ensureBoardMembers() {
  if (state.members.length || !state.users.length) return;
  for (const member of seedMemberships(state.users)) await put("members", member);
  state.members = await all("members");
}

async function refresh() {
  if (flushReportEditors()) await persistReportLayout();
  state.users = await all("users");
  state.members = await all("members");
  state.tasks = await all("tasks");
  state.projects = await all("projects");
  state.engagements = await all("engagements");
  state.engagementTasks = await all("engagementTasks");
  state.columns = await all("columns");
  state.tags = (await all("tags")).slice().sort((a, b) => a.name.localeCompare(b.name));
  await loadReportLayouts();
  await ensureBoardMembers();
  const id = localStorage.getItem("ledgerlane-session");
  state.user = state.users.find((u) => u.id === id) || null;
  await migrateWorkspace();
  const valid = new Set(state.tasks.map((task) => task.id));
  state.selection = new Set([...state.selection].filter((taskId) => valid.has(taskId)));
  const knownTags = new Set(state.tags.map((tag) => tag.id));
  state.filters.tags = normalizeTagIds(state.filters.tags).filter((id) => knownTags.has(id));
  state.filters.colors = [...new Set((state.filters.colors || []).map(normalizeCardColor))];
  if (state.report.projectIds) {
    const known = new Set(state.projects.map((project) => project.id));
    state.report.projectIds = state.report.projectIds.filter((projectId) => known.has(projectId));
  }
  if (state.activeEngagementId && !state.engagements.some((engagement) => engagement.id === state.activeEngagementId)) {
    state.activeEngagementId = null;
  }
  const peopleOpen = document.querySelector("#people-dialog")?.open;
  render();
  if (peopleOpen) fillPeopleDialog();
}

function renderAuth(error = "") {
  const signup = state.authMode === "signup";
  const hint = signup
    ? "Accounts stay on this computer. The first account becomes the board admin. Later people wait for an invite."
    : "Use the username and passphrase saved in this browser.";
  const rolePick = signup ? `<details class="advanced-options" id="account-type-options"><summary>Account type</summary><fieldset class="role-pick"><legend class="visually-hidden">Account type</legend><label class="mode-card" for="role-editor"><input id="role-editor" name="role" type="radio" value="editor" checked> <span>Editor<small>Create, move, and edit tasks.</small></span></label><label class="mode-card" for="role-admin"><input id="role-admin" name="role" type="radio" value="admin"> <span>Admin<small>Labeled Admin. Board access still needs an invite after the first account.</small></span></label><label class="mode-card" for="role-viewer"><input id="role-viewer" name="role" type="radio" value="viewer"> <span>View only<small>See the board after an invite. Cannot edit.</small></span></label></fieldset><p class="hint">This is a label. Board access is invite-only after the first account.</p></details>` : "";
  root.innerHTML = `<main class="auth-page"><section class="auth-art"><div class="brand"><span class="brand-mark">LL</span> LEDGERLANE</div><h1>WORK,<br>ACCOUNTED<br>FOR.</h1><div><p class="statement">A local-first workspace for turning progress into proof — without sending your data anywhere.</p><p class="mono">PRIVATE BY DEFAULT / LOCAL BY DESIGN</p></div></section><section class="auth-card"><form id="auth-form"><div class="auth-tabs"><button type="button" data-auth="signup" class="${signup ? "active" : ""}">Create account</button><button type="button" data-auth="login" class="${signup ? "" : "active"}">Sign in</button></div><p class="eyebrow">Local workspace</p><h2>${signup ? "Start your ledger." : "Welcome back."}</h2><p class="hint">${hint}</p>${error ? `<p class="auth-error">${escapeHtml(error)}</p>` : ""}<div class="form" style="padding:24px 0">${signup ? `<div class="field"><label for="name">Display name</label><input id="name" name="name" required placeholder="e.g. Morgan Lee"></div>` : ""}<div class="field"><label for="username">Username</label><input id="username" name="username" required autocomplete="username" placeholder="morgan"></div><div class="field"><label for="password">Passphrase</label><input id="password" name="password" type="password" minlength="6" required autocomplete="${signup ? "new-password" : "current-password"}" placeholder="At least 6 characters"></div>${signup ? `<p class="hint">At least 6 characters, stored only here.</p>` : ""}${rolePick}<button class="button primary" type="submit">${signup ? "Create local account →" : "Enter workspace →"}</button></div></form></section></main>`;
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
  const billing = await writeTag("billing");
  const ops = await writeTag("ops");
  const seeds = [
    ["Reconcile Q3 vendor receipts", "Finance ops", "high", "backlog", 2400, -6, [billing?.id], "coral"],
    ["Map approval workflow", "Finance ops", "medium", "backlog", 1200, -5, [ops?.id], "blue"],
    ["Implement billing summary", "Atlas rollout", "high", "progress", 4800, -4, [billing?.id], "coral"],
    ["Review stakeholder brief", "Atlas rollout", "medium", "progress", 900, -3, [ops?.id], "gold"],
    ["Close August retainers", "Client services", "low", "done", 3200, -8, [billing?.id], "sage"],
    ["Publish migration notes", "Atlas rollout", "medium", "done", 1800, -7, [], "none"]
  ];
  const cache = new Map();
  for (const [title, projectName, priority, status, rate, days, tagIds, color] of seeds) {
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
      timestampOverridden: false, sortOrder: now + days,
      tagIds: normalizeTagIds(tagIds), color: normalizeCardColor(color)
    });
  }
}

function peopleTrigger() {
  const people = boardPeople();
  const shown = people.slice(0, 3);
  const extra = people.length - shown.length;
  return `<button type="button" class="people-trigger" id="open-people" aria-label="People on this board">
    <span class="facepile">${shown.map((person, index) => `<span class="face face-${(index % 3) + 1}" title="${escapeHtml(person.name)}">${escapeHtml(initials(person.name))}</span>`).join("")}</span>
    <span class="people-label">People${extra > 0 ? ` +${extra}` : ""}</span>
  </button>`;
}

function boardAdminNames() {
  return boardPeople().filter((person) => person.member.role === "admin").map((person) => person.name);
}

function waitingView() {
  const who = naturalJoin(boardAdminNames());
  return `<main class="main waiting-page" id="waiting-access">
    <header class="page-head"><div><p class="eyebrow">Access</p><h1>Not on this board yet.</h1></div></header>
    <p class="waiting-copy">You’re signed in. Ask <strong class="waiting-admins">${escapeHtml(who)}</strong> to invite you.</p>
    <button class="button" type="button" id="waiting-sign-out">Sign out</button>
  </main>`;
}

function accountChrome(access) {
  const role = access ? (currentBoardRole() || "editor") : "none";
  const caption = access ? roleCaption({ role }) : "No access";
  return `${access ? peopleTrigger() : ""}
    <span class="account-name"><strong>${escapeHtml(state.user.name)}</strong><br><small class="stamp">${escapeHtml(caption)}</small></span>
    <div class="menu" data-menu="account-menu">
      <button type="button" class="avatar" id="account-button" data-menu-toggle aria-expanded="false" aria-haspopup="menu" aria-label="Account menu">${escapeHtml(initials(state.user.name))}</button>
      <div class="menu-panel account-menu-panel" id="account-menu-panel" role="menu" hidden>
        <p class="account-menu-id"><strong>${escapeHtml(state.user.name)}</strong><small>${escapeHtml(caption)}</small></p>
        <button type="button" class="menu-item" role="menuitem" id="sign-out-button"><strong>Sign out</strong><small>Return with the same local passphrase.</small></button>
      </div>
    </div>`;
}

function shell(content, { access = true } = {}) {
  const role = access ? (currentBoardRole() || "editor") : "none";
  const nav = access ? `<nav class="main-nav"><button class="nav-btn ${state.view === "board" ? "active" : ""}" data-view="board">Board</button><button class="nav-btn ${state.view === "reports" ? "active" : ""}" data-view="reports">Reports</button><button class="nav-btn ${state.view === "engagements" ? "active" : ""}" data-view="engagements">Engagements</button></nav>` : "";
  const mobile = access ? `<nav class="mobile-nav"><button class="${state.view === "board" ? "active" : ""}" data-view="board">Board</button><button class="${state.view === "reports" ? "active" : ""}" data-view="reports">Reports</button><button class="${state.view === "engagements" ? "active" : ""}" data-view="engagements">Engagements</button></nav>` : "";
  const structure = access && canEdit()
    ? state.view === "reports"
      ? `<button type="button" class="board-structure-toggle" id="edit-report" aria-pressed="${state.reportEditing ? "true" : "false"}" aria-label="${state.reportEditing ? "Stop editing report" : "Edit report"}"><span aria-hidden="true">✏</span><span class="board-structure-label">${state.reportEditing ? "Editing report" : "Edit report"}</span></button>`
      : state.view === "board" ? `<button type="button" class="board-structure-toggle" id="edit-board" aria-pressed="${state.boardStructure ? "true" : "false"}" aria-label="${state.boardStructure ? "Stop editing board" : "Edit board"}"><span aria-hidden="true">✏</span><span class="board-structure-label">${state.boardStructure ? "Editing board" : "Edit board"}</span></button>` : ""
    : "";
  return `<div class="app-shell ${role === "viewer" ? "is-viewer" : ""} ${state.boardStructure ? "is-structuring" : ""} ${state.reportEditing ? "is-editing-report" : ""}" data-role="${role}"><header class="topbar"><div class="brand"><span class="brand-mark">LL</span> LEDGERLANE</div>${nav}<div class="account-area">${structure}${accountChrome(access)}</div></header>${content}${mobile}</div>`;
}

async function signOutUser() {
  closeActionMenus();
  if (!state.user) return;
  if (await askConfirm({ title: "Sign out?", message: `Sign out ${state.user.name}? You can return with the same local passphrase.`, confirmLabel: "Sign out" })) {
    localStorage.removeItem("ledgerlane-session");
    state.user = null;
    state.view = "board";
    state.boardStructure = false;
    state.structureRestoreAll = false;
    state.reportEditing = false;
    state.reportFocusBlockId = null;
    state.suppressCardClick = false;
    render();
  }
}

function firstProjectId() {
  return state.projects.slice().sort((a, b) => a.name.localeCompare(b.name))[0]?.id || "all";
}

function setBoardStructure(on) {
  if (on) {
    if (!state.boardStructure && (state.filters.project === "all" || !state.filters.project)) {
      state.structureRestoreAll = true;
      const id = firstProjectId();
      if (id !== "all") state.filters.project = id;
    }
    state.boardStructure = true;
  } else {
    state.boardStructure = false;
    if (state.structureRestoreAll) {
      state.filters.project = "all";
      state.structureRestoreAll = false;
    }
  }
  render();
}

function bindAccount() {
  const leave = (event) => {
    event.preventDefault();
    signOutUser();
  };
  document.querySelector("#sign-out-button")?.addEventListener("click", leave);
  document.querySelector("#waiting-sign-out")?.addEventListener("click", leave);
}

function render() {
  if (flushReportEditors()) persistReportLayout();
  if (!state.user) return renderAuth();
  const access = canAccessBoard(state.user, state.members);
  root.innerHTML = shell(access ? (state.view === "board" ? boardView() : state.view === "engagements" ? engagementsView() : reportsView()) : waitingView(), { access });
  bindAccount();
  bindActionMenus();
  document.querySelector("#edit-board")?.addEventListener("click", () => setBoardStructure(!state.boardStructure));
  document.querySelector("#edit-report")?.addEventListener("click", () => setReportEditing(!state.reportEditing));
  if (!access) return;
  document.querySelectorAll("[data-view]").forEach((button) => button.onclick = () => { state.view = button.dataset.view; render(); });
  document.querySelector("#open-people").onclick = () => openPeopleDialog();
  if (state.view === "board") bindBoard();
  else if (state.view === "engagements") bindEngagements();
  else bindReports();
}

async function writeTag(rawName) {
  const name = normalizeTagName(rawName);
  if (!name) return null;
  const existing = findTagByName(state.tags, name);
  if (existing) return existing;
  const tag = { id: uuid(), name, createdAt: new Date().toISOString() };
  await put("tags", tag);
  state.tags = [...state.tags, tag].sort((a, b) => a.name.localeCompare(b.name));
  return tag;
}

async function createTag(rawName) {
  if (!guardEdit()) return null;
  return writeTag(rawName);
}

async function patchTask(id, changes) {
  if (!guardEdit()) return null;
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return null;
  const next = { ...task, ...changes };
  await put("tasks", next);
  return next;
}

function toggleCardMenu(id) {
  if (!guardEdit()) return;
  state.openCardMenu = state.openCardMenu === id ? null : id;
  state.cardMenuFocus = Boolean(state.openCardMenu?.startsWith("card-tags-"));
  render();
}

async function setTaskColor(taskId, color) {
  const next = await patchTask(taskId, { color: normalizeCardColor(color) });
  if (!next) return false;
  state.openCardMenu = null;
  toast("Card color saved");
  await refresh();
  return true;
}

async function toggleTaskTag(taskId, tagId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return false;
  const next = await patchTask(taskId, { tagIds: toggleListValue(normalizeTagIds(task.tagIds), tagId) });
  if (!next) return false;
  state.openCardMenu = `card-tags-${taskId}`;
  await refresh();
  return true;
}

async function addTagToCard(taskId, rawName, input) {
  if (!guardEdit()) return;
  const name = normalizeTagName(rawName);
  if (!name) {
    toast("Name the tag");
    input?.focus();
    return;
  }
  const existed = Boolean(findTagByName(state.tags, name));
  const tag = await createTag(name);
  if (!tag) return;
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  await patchTask(taskId, { tagIds: normalizeTagIds([...(task.tagIds || []), tag.id]) });
  state.openCardMenu = `card-tags-${taskId}`;
  state.cardMenuFocus = true;
  toast(existed ? "Tag already exists" : "Tag added");
  await refresh();
}

async function ensureTagIds(names = []) {
  const ids = [];
  for (const name of names) {
    const tag = await writeTag(name);
    if (tag) ids.push(tag.id);
  }
  return ids;
}

function visibleTasks() {
  return filterTasks(state.tasks, { ...state.filters, tagCatalog: state.tags });
}

function tagsForTask(task) {
  const ids = new Set(normalizeTagIds(task?.tagIds));
  return state.tags.filter((tag) => ids.has(tag.id));
}

function clearBoardFilters() {
  state.filters = emptyBoardFilters();
  if (state.boardStructure) {
    state.boardStructure = false;
    state.structureRestoreAll = false;
  }
  render();
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

function facetBarMarkup(visibleCount) {
  const edit = canEdit();
  const active = boardFiltersActive(state.filters);
  const selectedTags = new Set(normalizeTagIds(state.filters.tags));
  const selectedColors = new Set((state.filters.colors || []).map(normalizeCardColor));
  const tagChips = state.tags.length
    ? state.tags.map((tag) => {
      const on = selectedTags.has(tag.id);
      return `<button type="button" class="facet-chip" data-filter-tag="${tag.id}" aria-pressed="${on ? "true" : "false"}">${escapeHtml(tag.name)}</button>`;
    }).join("")
    : `<span class="facet-empty">None yet</span>`;
  const colorChips = CARD_COLORS.map((color) => {
    const on = selectedColors.has(color.id);
    return `<button type="button" class="color-swatch" data-filter-color="${color.id}" aria-pressed="${on ? "true" : "false"}" aria-label="Filter ${escapeHtml(color.label)}">
      <span class="color-swatch-fill" data-color="${color.id}"></span>
      <span>${escapeHtml(color.label)}</span>
    </button>`;
  }).join("");
  const create = edit
    ? `<form id="new-tag-form" class="new-tag-form">
        <label class="visually-hidden" for="new-tag-name">New tag</label>
        <input id="new-tag-name" maxlength="32" placeholder="New tag" autocomplete="off">
        <button class="button" type="submit">Add tag</button>
      </form>`
    : "";
  return `<section class="facet-bar" aria-label="Tag and color filters">
    <div class="facet-row">
      <span class="facet-label">Tags</span>
      <div class="facet-chips" id="tag-filters">${tagChips}</div>
      ${create}
    </div>
    <div class="facet-row">
      <span class="facet-label">Color</span>
      <div class="facet-chips" id="color-filters">${colorChips}</div>
      ${active ? `<button type="button" class="button ghost" id="clear-filters">Clear filters</button>` : ""}
    </div>
    ${active ? `<p class="filter-status" id="filter-status">Showing ${visibleCount} of ${state.tasks.length} tasks</p>` : ""}
  </section>`;
}

function boardView() {
  const visible = visibleTasks();
  const columns = visibleColumns();
  const selectedCount = [...state.selection].filter((id) => visible.some((task) => task.id === id)).length;
  const scopedProject = state.projects.find((project) => project.id === state.filters.project);
  const edit = canEdit();
  const structuring = edit && state.boardStructure;
  return `<main class="main">
    <header class="page-head page-head-work">
      <div><p class="eyebrow">Board</p><h1 class="page-title">Delivery</h1></div>
      <div class="page-actions">${edit ? `
        <button class="button acid" id="new-task" type="button">New task</button>
        <button class="button" id="new-engagement" type="button">Follow-on engagement</button>
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
    ${structuring ? `<section class="structure-bar" id="structure-bar" aria-label="Board structure">
      <div class="structure-copy">
        <p><strong>Editing board columns.</strong> Click a column name or ✏ to rename, change type, or delete.</p>
        ${state.projects.length ? `<div class="field structure-project-field"><label for="structure-project">Project</label><select id="structure-project">${state.projects.map((project) => `<option value="${project.id}" ${state.filters.project === project.id ? "selected" : ""}>${escapeHtml(project.name)}</option>`).join("")}</select></div>` : `<p class="hint">Create a project first — columns belong to a project.</p>`}
      </div>
      <div class="structure-actions">
        <button class="button" id="new-project" type="button">New project</button>
        <button class="button" id="done-structure" type="button">Done</button>
      </div>
    </section>` : ""}
    <section class="toolbar" aria-label="Board filters">
      <input class="search" id="search" value="${escapeHtml(state.filters.query)}" placeholder="⌕ Search tasks or projects…">
      <select class="select" id="owner-filter"><option value="all">All owners</option>${memberUsers().map((u) => `<option value="${u.id}" ${state.filters.owner === u.id ? "selected" : ""}>${escapeHtml(u.name)}</option>`).join("")}</select>
      <select class="select" id="project-filter"><option value="all">All projects</option>${state.projects.map((p) => `<option value="${p.id}" ${state.filters.project === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}</select>
      ${edit ? `<label class="toolbar-select check-line"><input type="checkbox" id="select-all" ${visible.length && selectedCount === visible.length ? "checked" : ""}> Select</label>` : ""}
    </section>
    ${facetBarMarkup(visible.length)}
    ${edit ? `<section class="selection-bar" id="selection-bar" ${selectedCount ? "" : "hidden"} aria-label="Selected tasks">
      <span class="selection-count" id="selection-count">${selectedCount} selected</span>
      <button class="button" id="delete-selected" type="button" ${selectedCount ? "" : "disabled"}>Delete selected</button>
      <button class="button ghost" id="clear-selection" type="button">Clear</button>
    </section>` : ""}
    <section class="kanban">${columns.map((column) => columnMarkup(column, visible)).join("")}${structuring && scopedProject ? addColumnMarkup() : ""}</section>
    ${edit ? `<button class="button acid fab-new-task" id="fab-new-task" type="button">New task</button>` : ""}
  </main>${taskDialog()}`;
}

function engagementTasksFor(engagementId) {
  return state.engagementTasks
    .filter((task) => task.engagementId === engagementId)
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

function activeEngagement() {
  const ordered = state.engagements.slice().sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  const selected = ordered.find((engagement) => engagement.id === state.activeEngagementId) || ordered[0] || null;
  if (selected) state.activeEngagementId = selected.id;
  return selected;
}

function engagementNote(engagement) {
  const terms = normalizeEngagementTerms(engagement?.terms);
  if (terms === "barter") return engagement?.exchangeNote || "Exchange details not set";
  if (terms === "community-partnership") return engagement?.arrangementNote || "Advocacy arrangement not set";
  return engagementCashAmount(engagement) ? `${usd(engagement.amount)} USD` : "Amount not set";
}

function engagementIndexMarkup(active) {
  const list = state.engagements.slice().sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  if (!list.length) return `<p class="hint">Your next piece of work will live here.</p>`;
  return `<div class="engagement-index-list">${list.map((engagement) => `<button type="button" class="engagement-index-item ${engagement.id === active?.id ? "active" : ""}" data-select-engagement="${engagement.id}">
      <strong>${escapeHtml(engagement.name)}</strong>
      <span>${escapeHtml(engagementTermsLabel(engagement.terms))}${engagement.projectId ? " · Board saved" : " · Work list"}</span>
    </button>`).join("")}</div>`;
}

function engagementTaskMarkup(task, editable) {
  const timing = engagementWorkTimingLabel(task);
  return `<li class="engagement-task-row" data-engagement-task="${task.id}">
    <button type="button" class="engagement-task-copy" data-edit-engagement-task="${task.id}" ${editable ? "" : "disabled"}>
      <strong>${escapeHtml(task.title)}</strong>
      ${task.notes ? `<span>${escapeHtml(task.notes)}</span>` : ""}
    </button>
    ${timing !== "Undated" ? `<span class="engagement-timing">${escapeHtml(timing)}</span>` : ""}
    ${editable ? `<button type="button" class="button ghost engagement-task-edit" data-edit-engagement-task="${task.id}">Edit</button>` : ""}
  </li>`;
}

function engagementsView() {
  const engagement = activeEngagement();
  const edit = canEdit();
  const saved = Boolean(engagement?.projectId);
  const prior = state.projects.find((project) => project.id === engagement?.priorProjectId);
  const tasks = engagement ? engagementTasksFor(engagement.id) : [];
  const summary = engagement ? `<div class="engagement-summary" aria-label="Engagement terms">
    <span class="engagement-term">${escapeHtml(engagementTermsLabel(engagement.terms))}</span>
    <span>${escapeHtml(engagementNote(engagement))}</span>
    ${prior ? `<span>Linked to prior work: <strong>${escapeHtml(prior.name)}</strong></span>` : ""}
  </div>` : "";
  const content = engagement ? `<section class="engagement-workspace">
      <header class="engagement-head">
        <div><p class="eyebrow">Follow-on engagement</p><h1 class="page-title">${escapeHtml(engagement.name)}</h1>${summary}</div>
        <div class="engagement-actions">
          ${actionMenu("engagement-share", "Print / export", [
            menuItem("print-engagement", "Print / save as PDF", "Print this work list, or choose Save as PDF in the print dialog")
          ])}
          ${saved
            ? `<span class="engagement-saved">Project board saved</span><button class="button acid" type="button" id="open-engagement-board">Open project board</button>`
            : edit ? `<button class="button acid" type="button" id="save-engagement-board">Save as project board</button>` : ""}
        </div>
      </header>
      ${saved ? `<p class="engagement-board-note">This work list is now linked to its project board. Keep day-to-day task changes on the board; the engagement keeps the original terms.</p>` : ""}
      <section class="engagement-list-section" aria-label="Engagement work list">
        <div class="engagement-list-heading"><h2>Work list</h2><span>${tasks.length} item${tasks.length === 1 ? "" : "s"}</span></div>
        <ol class="engagement-task-list" id="engagement-task-list">${tasks.length ? tasks.map((task) => engagementTaskMarkup(task, edit && !saved)).join("") : `<li class="engagement-list-empty">No tasks yet. Capture the next step below.</li>`}</ol>
        ${edit && !saved ? `<form id="quick-engagement-task" class="quick-engagement-task">
          <label class="visually-hidden" for="quick-engagement-task-title">Add a task</label>
          <div class="quick-engagement-row"><input id="quick-engagement-task-title" name="title" required maxlength="140" autocomplete="off" placeholder="Add a task — press Enter to keep stacking"><button class="button" type="submit">Add task</button></div>
          <details class="quick-engagement-details" id="quick-engagement-details">
            <summary>Add notes or timing</summary>
            <div class="quick-engagement-fields">
              <label class="field"><span>Notes (optional)</span><textarea name="notes" placeholder="A little context, if it helps"></textarea></label>
              <label class="field"><span>When</span><select name="timing" id="quick-engagement-timing"><option value="undated">Undated</option><option value="date">Specific date</option><option value="ongoing">Ongoing</option></select></label>
              <label class="field" id="quick-engagement-date-field" hidden><span>Date</span><input name="dueDate" type="date"></label>
            </div>
          </details>
        </form>` : ""}
      </section>
    </section>` : `<section class="engagement-empty">
      <p class="eyebrow">Follow-on engagements</p><h1 class="page-title">Capture the next stretch of work.</h1>
      <p class="hint">Start a simple work list for a relationship that already exists. It stays out of the board until you choose to save it as one.</p>
      ${edit ? `<button class="button acid" type="button" id="start-engagement">New follow-on engagement</button>` : ""}
    </section>`;
  return `<main class="main engagements-page">
    <header class="page-head page-head-work engagement-page-head"><div><p class="eyebrow">Engagements</p><h1 class="page-title">Follow-on work</h1></div>${edit ? `<button class="button" type="button" id="new-engagement">New engagement</button>` : ""}</header>
    <div class="engagement-layout"><aside class="engagement-index"><p class="eyebrow">Work lists</p>${engagementIndexMarkup(engagement)}</aside>${content}</div>
  </main>`;
}

function syncEngagementTermFields(form = document.querySelector("#engagement-form")) {
  if (!form) return;
  const terms = normalizeEngagementTerms(form.elements.terms?.value);
  const exchange = document.querySelector("#engagement-exchange-field");
  const arrangement = document.querySelector("#engagement-arrangement-field");
  const cashOverride = document.querySelector("#engagement-cash-override");
  const amountField = document.querySelector("#engagement-amount-field");
  const amountLabel = document.querySelector("#engagement-amount-field label");
  const amountHint = document.querySelector("#engagement-amount-hint");
  const nonCash = ["barter", "community-partnership"].includes(terms);
  const showCashOverride = nonCash;
  const showAmount = !nonCash || Boolean(form.elements.cashOverride?.checked);
  if (exchange) exchange.hidden = terms !== "barter";
  if (arrangement) arrangement.hidden = terms !== "community-partnership";
  if (cashOverride) cashOverride.hidden = !showCashOverride;
  if (amountField) amountField.hidden = !showAmount;
  if (nonCash && !showAmount && form.elements.amount) form.elements.amount.value = "";
  if (amountLabel) amountLabel.textContent = nonCash ? "Cash amount (USD, optional)" : "Amount (USD, optional)";
  if (amountHint) amountHint.textContent = nonCash
    ? "Non-cash by default. Only set a cash amount when this arrangement truly has one."
    : "Optional for one-time or retainer work.";
}

function fillEngagementPriorProjects(selectedId = "") {
  const select = document.querySelector("#engagement-prior-project");
  if (!select) return;
  select.innerHTML = `<option value="">No linked prior project</option>${state.projects.map((project) => `<option value="${project.id}">${escapeHtml(project.name)}</option>`).join("")}`;
  select.value = state.projects.some((project) => project.id === selectedId) ? selectedId : "";
}

function openEngagementDialog({ priorProjectId = "" } = {}) {
  if (!guardEdit()) return;
  const dialog = document.querySelector("#engagement-dialog");
  const form = document.querySelector("#engagement-form");
  form.reset();
  document.querySelector("#engagement-advanced").open = false;
  fillEngagementPriorProjects(priorProjectId);
  syncEngagementTermFields(form);
  document.querySelector("#close-engagement").onclick = document.querySelector("#cancel-engagement").onclick = () => dialog.close();
  form.onchange = (event) => { if (event.target.name === "terms" || event.target.name === "cashOverride") syncEngagementTermFields(form); };
  form.onsubmit = async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const terms = normalizeEngagementTerms(data.get("terms"));
    if (!name || !terms) return;
    const rawAmount = String(data.get("amount") || "").trim();
    const amount = rawAmount === "" ? null : Math.max(0, Number(rawAmount) || 0);
    const engagement = {
      id: uuid(), name, terms, amount,
      exchangeNote: String(data.get("exchangeNote") || "").trim(),
      arrangementNote: String(data.get("arrangementNote") || "").trim(),
      priorProjectId: String(data.get("priorProjectId") || ""),
      projectId: null, createdAt: new Date().toISOString()
    };
    await put("engagements", engagement);
    state.activeEngagementId = engagement.id;
    state.view = "engagements";
    dialog.close();
    toast("Follow-on engagement created");
    await refresh();
  };
  dialog.showModal();
  form.elements.name.focus();
}

function syncEngagementTaskDate(form = document.querySelector("#engagement-task-form"), field = document.querySelector("#engagement-task-date-field")) {
  if (field) field.hidden = form?.elements.timing?.value !== "date";
}

function openEngagementTaskDialog(id) {
  if (!guardEdit()) return;
  const engagement = activeEngagement();
  if (!engagement || engagement.projectId) return;
  const task = state.engagementTasks.find((item) => item.id === id && item.engagementId === engagement.id);
  if (!task) return;
  const dialog = document.querySelector("#engagement-task-dialog");
  const form = document.querySelector("#engagement-task-form");
  form.reset();
  form.elements.id.value = task.id;
  form.elements.title.value = task.title;
  form.elements.notes.value = task.notes || "";
  form.elements.timing.value = task.timing || "undated";
  form.elements.dueDate.value = task.dueDate || "";
  syncEngagementTaskDate(form);
  document.querySelector("#delete-engagement-task").hidden = false;
  document.querySelector("#close-engagement-task").onclick = document.querySelector("#cancel-engagement-task").onclick = () => dialog.close();
  document.querySelector("#engagement-task-timing").onchange = () => syncEngagementTaskDate(form);
  document.querySelector("#delete-engagement-task").onclick = async () => {
    const ok = await askConfirm({ title: "Delete task?", message: `Delete ${task.title} from this work list?`, confirmLabel: "Delete task" });
    if (!ok) return;
    await remove("engagementTasks", task.id);
    dialog.close();
    toast("Task deleted");
    await refresh();
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const timing = String(data.get("timing") || "undated");
    const next = { ...task, title: String(data.get("title") || "").trim(), notes: String(data.get("notes") || "").trim(), timing, dueDate: timing === "date" ? String(data.get("dueDate") || "") : "" };
    if (!next.title) return;
    await put("engagementTasks", next);
    dialog.close();
    toast("Task saved");
    await refresh();
  };
  dialog.showModal();
  form.elements.title.focus();
}

async function addQuickEngagementTask(event) {
  event.preventDefault();
  if (!guardEdit()) return;
  const engagement = activeEngagement();
  if (!engagement || engagement.projectId) return;
  const form = event.currentTarget;
  const data = new FormData(form);
  const title = String(data.get("title") || "").trim();
  if (!title) return;
  const timing = String(data.get("timing") || "undated");
  await put("engagementTasks", {
    id: uuid(), engagementId: engagement.id, title,
    notes: String(data.get("notes") || "").trim(), timing,
    dueDate: timing === "date" ? String(data.get("dueDate") || "") : "",
    status: "backlog", sortOrder: Date.now(), createdAt: new Date().toISOString()
  });
  form.reset();
  document.querySelector("#quick-engagement-date-field").hidden = true;
  toast("Task added");
  await refresh();
  document.querySelector("#quick-engagement-task-title")?.focus();
}

async function saveEngagementAsProjectBoard() {
  if (!guardEdit()) return;
  const engagement = activeEngagement();
  if (!engagement) return;
  if (engagement.projectId) return openEngagementBoard();
  const project = await createProjectRecord(engagement.name, { engagementId: engagement.id, priorProjectId: engagement.priorProjectId || null });
  const projectColumns = (await all("columns")).filter((column) => column.projectId === project.id);
  const todo = projectColumns.find((column) => column.type === "todo");
  const list = engagementTasksFor(engagement.id);
  await Promise.all(list.map((item, index) => {
    const column = projectColumns.find((candidate) => candidate.type === statusToColumnType(item.status)) || todo;
    return put("tasks", {
      id: uuid(), title: item.title, project: project.name, projectId: project.id, columnId: column.id,
      ownerId: state.user.id, ownerName: state.user.name, status: columnTypeToStatus(column.type), priority: "medium",
      description: item.notes || "", rate: 0, createdAt: item.createdAt || new Date().toISOString(),
      completedAt: column.type === "complete" ? new Date().toISOString() : null,
      timestampOverridden: false, sortOrder: index, tagIds: [], color: "none",
      engagementId: engagement.id, engagementTaskId: item.id, engagementTiming: item.timing || "undated", engagementDueDate: item.dueDate || ""
    });
  }));
  await put("engagements", { ...engagement, projectId: project.id, savedAt: new Date().toISOString() });
  state.filters.project = project.id;
  state.view = "board";
  toast("Saved as project board");
  await refresh();
}

function openEngagementBoard() {
  const engagement = activeEngagement();
  if (!engagement?.projectId) return;
  state.filters.project = engagement.projectId;
  state.view = "board";
  render();
}

function printEngagement() {
  if (!activeEngagement()) return;
  closeActionMenus();
  print();
}

function bindEngagements() {
  document.querySelector("#new-engagement")?.addEventListener("click", () => openEngagementDialog());
  document.querySelector("#start-engagement")?.addEventListener("click", () => openEngagementDialog());
  document.querySelectorAll("[data-select-engagement]").forEach((button) => {
    button.onclick = () => { state.activeEngagementId = button.dataset.selectEngagement; render(); };
  });
  document.querySelector("#quick-engagement-task")?.addEventListener("submit", addQuickEngagementTask);
  document.querySelector("#quick-engagement-timing")?.addEventListener("change", (event) => {
    document.querySelector("#quick-engagement-date-field").hidden = event.target.value !== "date";
  });
  document.querySelectorAll("[data-edit-engagement-task]").forEach((button) => {
    button.onclick = () => openEngagementTaskDialog(button.dataset.editEngagementTask);
  });
  document.querySelector("#save-engagement-board")?.addEventListener("click", saveEngagementAsProjectBoard);
  document.querySelector("#open-engagement-board")?.addEventListener("click", openEngagementBoard);
  document.querySelector("#print-engagement")?.addEventListener("click", printEngagement);
}

function columnMarkup(column, visible) {
  const tasks = sortTasks(visible.filter((task) => column.virtual ? task.status === columnTypeToStatus(column.type) : task.columnId === column.id));
  const typeLabel = COLUMN_TYPES.find((item) => item.id === column.type)?.label || column.type;
  const structuring = canEdit() && state.boardStructure && !column.virtual;
  const pencil = structuring
    ? `<button type="button" class="column-edit" data-edit-column="${column.id}" aria-label="Edit column ${escapeHtml(column.name)}">✏</button>`
    : "";
  const title = structuring
    ? `<h2><button type="button" class="column-title-btn" data-edit-column="${column.id}">${escapeHtml(column.name)}</button></h2>`
    : `<h2>${escapeHtml(column.name)}</h2>`;
  return `<div class="column ${structuring ? "is-structuring" : ""}" data-drop="${column.id}" data-column-type="${column.type}">
    <header class="column-head">
      ${title}
      <span class="column-meta">${pencil}<span class="count">${tasks.length}</span><span class="column-type">${escapeHtml(typeLabel)}</span></span>
    </header>
    <div class="card-list">${tasks.length ? tasks.map(taskCard).join("") : `<div class="empty">${canEdit() ? "Drop work here" : "No work here"}</div>`}</div>
  </div>`;
}

function addColumnMarkup() {
  return `<div class="add-column" id="add-column-panel">
    <button class="button" id="add-column-toggle" type="button">＋ Add column</button>
  </div>`;
}

function taskCard(task) {
  const selected = state.selection.has(task.id);
  const color = normalizeCardColor(task.color);
  const colorMeta = cardColorMeta(color);
  const tags = tagsForTask(task);
  const edit = canEdit();
  const colorOpen = edit && state.openCardMenu === `card-color-${task.id}`;
  const tagsOpen = edit && state.openCardMenu === `card-tags-${task.id}`;
  const clip = (task.attachmentCount || 0) > 0 ? `<span class="clip" title="Has attachments">▣</span>` : "";
  const colorToggle = edit
    ? `<button type="button" class="card-swatch-toggle" data-card-color-open="${task.id}" aria-expanded="${colorOpen ? "true" : "false"}" aria-label="Set card color, ${escapeHtml(colorMeta.label)}">
        <span class="color-swatch-fill" data-color="${color}"></span>
      </button>`
    : "";
  const colorPicker = colorOpen
    ? `<div class="card-inline-picker" role="group" aria-label="Card color">
        ${CARD_COLORS.map((item) => `<button type="button" class="card-color-option" data-set-card-color="${item.id}" data-task="${task.id}" aria-pressed="${item.id === color ? "true" : "false"}">
          <span class="color-swatch-fill" data-color="${item.id}"></span>
          <span>${escapeHtml(item.label)}</span>
        </button>`).join("")}
      </div>`
    : "";
  const tagButtons = tags.map((tag) => `<button type="button" class="card-tag" data-card-tag="${tag.id}">${escapeHtml(tag.name)}</button>`).join("");
  const tagAdd = edit
    ? `<button type="button" class="card-tag card-tag-add" data-card-tag-open="${task.id}" aria-expanded="${tagsOpen ? "true" : "false"}">＋ Tag</button>`
    : "";
  const tagPicker = tagsOpen
    ? `<div class="card-inline-picker card-tag-picker">
        ${state.tags.length
          ? `<div class="tag-option-list">${state.tags.map((tag) => {
            const on = tags.some((item) => item.id === tag.id);
            return `<label class="tag-option"><input type="checkbox" data-toggle-card-tag="${tag.id}" data-task="${task.id}" ${on ? "checked" : ""}> ${escapeHtml(tag.name)}</label>`;
          }).join("")}</div>`
          : `<p class="hint">No tags yet.</p>`}
        <div class="new-tag-row">
          <label class="visually-hidden" for="card-new-tag-${task.id}">New tag</label>
          <input id="card-new-tag-${task.id}" class="card-new-tag" maxlength="32" placeholder="New tag" autocomplete="off" data-task="${task.id}">
          <button class="button" type="button" data-add-card-tag="${task.id}">Add</button>
        </div>
      </div>`
    : "";
  const tagRow = (tags.length || edit)
    ? `<div class="card-tags">${tagButtons}${tagAdd}</div>${tagPicker}`
    : "";
  return `<article class="task-card ${selected ? "is-selected" : ""}" ${edit ? `draggable="true"` : ""} data-id="${task.id}" data-color="${color}" tabindex="0">
    <div class="card-top">
      ${edit ? `<label class="task-check"><input type="checkbox" data-select="${task.id}" ${selected ? "checked" : ""} aria-label="Select ${escapeHtml(task.title)}"></label>` : ""}
      <span class="tag ${task.priority}">${escapeHtml(task.priority)} priority</span>
      ${colorToggle}
    </div>
    ${colorPicker}
    <h3>${escapeHtml(task.title)}</h3>
    <p class="project">${escapeHtml(task.project)}</p>
    ${tagRow}
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
        <p class="eyebrow">Task</p>
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
        <details class="advanced-options" id="task-details">
          <summary>Task details</summary>
          <div class="task-chip-row">
            <label class="chip-field"><span>Status</span><select name="columnId" ${lock}></select></label>
            <label class="chip-field"><span>Project</span><span class="chip-combo"><select name="projectId" ${lock}>${projectOptions}</select>${locked ? "" : `<button class="chip-add" type="button" id="task-new-project" title="New project" aria-label="New project">＋</button>`}</span></label>
            <label class="chip-field"><span>Priority</span><select name="priority" ${lock}><option>low</option><option selected>medium</option><option>high</option></select></label>
            <label class="chip-field"><span>Owner</span><select name="ownerId" ${lock}>${memberUsers().map((u) => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join("")}</select></label>
          </div>
          <div class="task-meta-block">
            <span class="facet-label" id="task-tags-label">Tags</span>
            <div id="task-tag-list" class="tag-option-list" role="group" aria-labelledby="task-tags-label"></div>
            ${locked ? "" : `<div class="new-tag-row"><label class="visually-hidden" for="task-new-tag">New tag</label><input id="task-new-tag" maxlength="32" placeholder="New tag" autocomplete="off"><button class="button" type="button" id="add-task-tag">Add tag</button></div>`}
          </div>
          <fieldset class="color-picker" ${locked ? "disabled" : ""}>
            <legend>Card color</legend>
            <div class="color-picker-row" id="task-color-list"></div>
          </fieldset>
        </details>
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
  document.querySelector("#project-filter").onchange = (event) => {
    state.filters.project = event.target.value;
    if (state.filters.project === "all" && state.boardStructure) {
      state.boardStructure = false;
      state.structureRestoreAll = false;
    }
    render();
  };
  document.querySelector("#structure-project")?.addEventListener("change", (event) => {
    state.filters.project = event.target.value;
    state.structureRestoreAll = false;
    render();
  });
  document.querySelector("#close-dialog").onclick = document.querySelector("#cancel-task").onclick = () => closeTaskDialog();
  document.querySelectorAll(".task-card").forEach((card) => {
    card.onclick = () => { if (!state.suppressCardClick) openTask(card.dataset.id); };
    card.onkeydown = (event) => {
      if (event.key !== "Enter") return;
      if (event.target.closest(".card-swatch-toggle, .card-tag, .card-inline-picker, .task-check")) return;
      openTask(card.dataset.id);
    };
  });
  bindFacetFilters();
  if (!canEdit()) {
    document.querySelector("#export-tasks").onclick = () => openNotionExport();
    bindTaskEditor(dialog, true);
    return;
  }
  bindCardMarking();
  document.querySelectorAll("#new-task, #fab-new-task").forEach((button) => { button.onclick = () => openTask(); });
  document.querySelector("#new-engagement").onclick = () => openEngagementDialog({
    priorProjectId: state.filters.project !== "all" ? state.filters.project : ""
  });
  document.querySelector("#new-project")?.addEventListener("click", () => openProjectPrompt({ switchFilter: true }));
  document.querySelector("#done-structure")?.addEventListener("click", () => setBoardStructure(false));
  document.querySelector("#import-tasks").onclick = () => openImportDialog();
  document.querySelector("#export-tasks").onclick = () => openExportDialog();
  document.querySelector("#record-board").onclick = () => startRecording(null);
  document.querySelector("#task-form").onsubmit = saveTask;
  document.querySelector("#delete-task").onclick = deleteOpenTask;
  document.querySelector("#task-new-project").onclick = () => openProjectPrompt({ fromTask: true });
  document.querySelector("#select-all").onchange = (event) => {
    const visible = visibleTasks();
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
  const visible = visibleTasks();
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
  const visible = visibleTasks();
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

function bindFacetFilters() {
  document.querySelectorAll("[data-filter-tag]").forEach((button) => {
    button.onclick = () => {
      state.filters.tags = toggleListValue(state.filters.tags, button.dataset.filterTag);
      render();
    };
  });
  document.querySelectorAll("[data-filter-color]").forEach((button) => {
    button.onclick = () => {
      state.filters.colors = toggleListValue(state.filters.colors, button.dataset.filterColor);
      render();
    };
  });
  document.querySelectorAll("[data-card-tag]").forEach((button) => {
    button.onclick = (event) => {
      event.stopPropagation();
      state.filters.tags = toggleListValue(state.filters.tags, button.dataset.cardTag);
      render();
    };
    button.onpointerdown = (event) => event.stopPropagation();
  });
  document.querySelector("#clear-filters")?.addEventListener("click", () => clearBoardFilters());
  document.querySelector("#new-tag-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.querySelector("#new-tag-name");
    const name = input?.value || "";
    if (!normalizeTagName(name)) {
      toast("Name the tag");
      input?.focus();
      return;
    }
    const existed = Boolean(findTagByName(state.tags, name));
    const tag = await createTag(name);
    if (!tag) return;
    if (input) input.value = "";
    toast(existed ? "Tag already exists" : "Tag created");
    render();
    document.querySelector("#new-tag-name")?.focus();
  });
}

function stopCardChrome(node) {
  if (!node) return;
  node.addEventListener("click", (event) => event.stopPropagation());
  node.addEventListener("pointerdown", (event) => event.stopPropagation());
  node.addEventListener("keydown", (event) => event.stopPropagation());
}

function bindCardMarking() {
  document.querySelectorAll("[data-card-color-open]").forEach((button) => {
    stopCardChrome(button);
    button.onclick = (event) => {
      event.stopPropagation();
      toggleCardMenu(`card-color-${button.dataset.cardColorOpen}`);
    };
  });
  document.querySelectorAll("[data-card-tag-open]").forEach((button) => {
    stopCardChrome(button);
    button.onclick = (event) => {
      event.stopPropagation();
      toggleCardMenu(`card-tags-${button.dataset.cardTagOpen}`);
    };
  });
  document.querySelectorAll(".card-inline-picker").forEach((picker) => stopCardChrome(picker));
  document.querySelectorAll("[data-set-card-color]").forEach((button) => {
    button.onclick = async (event) => {
      event.stopPropagation();
      await setTaskColor(button.dataset.task, button.dataset.setCardColor);
    };
  });
  document.querySelectorAll("[data-toggle-card-tag]").forEach((input) => {
    input.onchange = async (event) => {
      event.stopPropagation();
      await toggleTaskTag(input.dataset.task, input.dataset.toggleCardTag);
    };
  });
  document.querySelectorAll("[data-add-card-tag]").forEach((button) => {
    button.onclick = async (event) => {
      event.stopPropagation();
      const taskId = button.dataset.addCardTag;
      const input = document.querySelector(`#card-new-tag-${CSS.escape(taskId)}`);
      await addTagToCard(taskId, input?.value || "", input);
    };
  });
  document.querySelectorAll(".card-new-tag").forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      document.querySelector(`[data-add-card-tag="${input.dataset.task}"]`)?.click();
    });
  });
  if (state.cardMenuFocus && state.openCardMenu?.startsWith("card-tags-")) {
    const taskId = state.openCardMenu.slice("card-tags-".length);
    document.querySelector(`#card-new-tag-${CSS.escape(taskId)}`)?.focus();
  }
  state.cardMenuFocus = false;
}

function selectedTaskTagIds() {
  return [...document.querySelectorAll('#task-tag-list input[name="tagIds"]:checked')].map((input) => input.value);
}

function renderTaskTagList(selectedIds, locked = !canEdit()) {
  const list = document.querySelector("#task-tag-list");
  if (!list) return;
  const selected = new Set(normalizeTagIds(selectedIds));
  if (!state.tags.length) {
    list.innerHTML = `<p class="hint" id="task-tag-empty">${locked ? "No tags on this board." : "No tags yet. Add one below."}</p>`;
    return;
  }
  list.innerHTML = state.tags.map((tag) => `<label class="tag-option"><input type="checkbox" name="tagIds" value="${tag.id}" ${selected.has(tag.id) ? "checked" : ""} ${locked ? "disabled" : ""}> ${escapeHtml(tag.name)}</label>`).join("");
}

function renderTaskColorList(selected, locked = !canEdit()) {
  const row = document.querySelector("#task-color-list");
  if (!row) return;
  const current = normalizeCardColor(selected);
  row.innerHTML = CARD_COLORS.map((color) => `<label class="color-choice">
    <input type="radio" name="color" value="${color.id}" ${current === color.id ? "checked" : ""} ${locked ? "disabled" : ""}>
    <span class="color-swatch-fill" data-color="${color.id}"></span>
    <span>${escapeHtml(color.label)}</span>
  </label>`).join("");
}

function bindColumnEdits() {
  document.querySelectorAll("[data-edit-column]").forEach((button) => {
    button.onclick = (event) => {
      event.stopPropagation();
      openColumnDialog({ columnId: button.dataset.editColumn });
    };
  });
  const toggle = document.querySelector("#add-column-toggle");
  if (toggle) toggle.onclick = () => openColumnDialog();
}

function fillColumnTypeSelect(select, types, current) {
  select.innerHTML = types.map((type) => `<option value="${type.id}">${escapeHtml(type.label)}${type.unique ? " (only one)" : ""}</option>`).join("");
  if (current && types.some((type) => type.id === current)) select.value = current;
  else if (types.some((type) => type.id === "todo")) select.value = "todo";
  else if (types[0]) select.value = types[0].id;
}

function columnTypeHint(types) {
  return types.some((type) => type.id === "complete")
    ? "To do and In progress can repeat. Complete can appear only once on a project."
    : "Complete is already on this project, so new columns are To do or In progress.";
}

function openColumnDialog({ columnId } = {}) {
  if (!guardEdit()) return;
  const editing = columnId ? state.columns.find((item) => item.id === columnId) : null;
  const projectId = editing?.projectId || state.filters.project;
  if (!projectId || projectId === "all") {
    toast("Choose a project to change columns");
    return;
  }
  const existing = columnsFor(projectId);
  const types = editing ? availableColumnTypesForEdit(existing, editing) : availableColumnTypes(existing);
  const dialog = document.querySelector("#column-dialog");
  const form = document.querySelector("#column-form");
  const select = document.querySelector("#column-type");
  const details = document.querySelector("#column-type-options");
  const hint = document.querySelector("#column-type-hint");
  const title = document.querySelector("#column-dialog-title");
  const submit = document.querySelector("#save-column");
  const removeBtn = document.querySelector("#delete-column");
  form.reset();
  title.textContent = editing ? "Edit column" : "Add column";
  submit.textContent = editing ? "Save column" : "Add column";
  form.elements.name.value = editing?.name || "";
  details.open = Boolean(editing);
  fillColumnTypeSelect(select, types, editing?.type);
  hint.textContent = columnTypeHint(types);
  const allowDelete = Boolean(editing && canDeleteColumn(existing));
  removeBtn.hidden = !editing;
  removeBtn.disabled = editing && !allowDelete;
  document.querySelector("#close-column").onclick = document.querySelector("#cancel-column").onclick = () => dialog.close();
  removeBtn.onclick = async () => {
    if (!editing) return;
    dialog.close();
    await deleteColumn(editing);
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (!guardEdit()) return;
    const name = form.elements.name.value.trim();
    const type = select.value || editing?.type || "todo";
    if (!name) return;
    if (editing) {
      if (type !== editing.type && !canAddColumnType(existing.filter((item) => item.id !== editing.id), type)) return;
      editing.name = name;
      editing.type = type;
      await put("columns", editing);
      const inColumn = state.tasks.filter((task) => task.columnId === editing.id);
      await Promise.all(inColumn.map((task) => put("tasks", applyColumn(task, editing))));
      toast("Column saved");
    } else {
      if (!canAddColumnType(existing, type)) return;
      await put("columns", { id: uuid(), projectId, name, type, order: existing.length });
      toast("Column added");
    }
    dialog.close();
    await refresh();
  };
  dialog.showModal();
  form.elements.name.focus();
}

async function deleteColumn(column) {
  if (!guardEdit()) return;
  const siblings = columnsFor(column.projectId);
  if (!canDeleteColumn(siblings)) {
    toast("A project needs at least one column");
    return;
  }
  const dest = destinationAfterColumnDelete(siblings, column.id);
  const moved = state.tasks.filter((task) => task.columnId === column.id);
  const ok = await askConfirm({
    title: "Delete column?",
    message: confirmDeleteColumnMessage(column.name, moved.length, dest?.name || ""),
    confirmLabel: "Delete column"
  });
  if (!ok || !dest) return;
  await Promise.all(moved.map((task) => put("tasks", applyColumn(task, dest))));
  await remove("columns", column.id);
  toast("Column deleted");
  await refresh();
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
    if (switchFilter) {
      state.filters.project = project.id;
      state.structureRestoreAll = false;
    }
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
  document.querySelector("#add-task-tag").onclick = async () => {
    const input = document.querySelector("#task-new-tag");
    const name = input?.value || "";
    if (!normalizeTagName(name)) {
      toast("Name the tag");
      input?.focus();
      return;
    }
    const existed = Boolean(findTagByName(state.tags, name));
    const tag = await createTag(name);
    if (!tag) return;
    if (input) input.value = "";
    const selected = new Set(selectedTaskTagIds());
    selected.add(tag.id);
    renderTaskTagList([...selected], false);
    toast(existed ? "Tag already exists" : "Tag added");
    input?.focus();
  };
  document.querySelector("#task-new-tag")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    document.querySelector("#add-task-tag")?.click();
  });
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
    state.openCardMenu = null;
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
    renderTaskTagList(task?.tagIds, !canEdit());
    renderTaskColorList(task?.color, !canEdit());
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
    ...(old || {}),
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
    sortOrder: old?.sortOrder ?? Date.now(),
    tagIds: normalizeTagIds(data.getAll("tagIds")),
    color: normalizeCardColor(data.get("color"))
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
  const visible = visibleTasks();
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

function reportEditing() {
  return Boolean(state.reportEditing && canEdit());
}

async function setReportEditing(on) {
  if (on && !guardEdit()) return;
  flushReportEditors();
  if (!on) {
    const layout = currentReportLayout();
    layout.blocks = layout.blocks.filter((block) => reportBlockHasContent(block.html));
  }
  state.reportEditing = Boolean(on);
  await persistReportLayout();
  render();
}

function reportInsertRail(slot, afterId = "") {
  const spec = REPORT_SLOTS.find((item) => item.id === slot);
  const after = Boolean(afterId);
  const label = after ? "Add note below" : `Add note ${spec?.label || ""}`.trim();
  return `<button type="button" class="report-insert" data-report-slot="${slot}"${after ? ` data-after="${afterId}"` : ""} aria-label="${escapeHtml(label)}"><span aria-hidden="true">＋</span> ${after ? "Add below" : "Add note"}</button>`;
}

function reportNoteMarkup(block, editing) {
  const html = prepareReportHtml(block.html);
  if (!editing && !reportBlockHasContent(html)) return "";
  if (!editing) {
    return `<section class="report-note is-readonly" data-note-id="${block.id}">
      <div class="report-note-body">${html}</div>
    </section>`;
  }
  return `<section class="report-note is-editing" data-note-id="${block.id}">
    <div class="report-note-tools">
      <div class="rtf-toolbar" role="toolbar" aria-label="Note formatting">
        <button type="button" data-cmd="bold" data-report-cmd="${block.id}" title="Bold"><strong>B</strong></button>
        <button type="button" data-cmd="italic" data-report-cmd="${block.id}" title="Italic"><em>I</em></button>
        <button type="button" data-cmd="underline" data-report-cmd="${block.id}" title="Underline"><u>U</u></button>
        <button type="button" data-cmd="insertUnorderedList" data-report-cmd="${block.id}" title="Bulleted list">• List</button>
        <button type="button" data-link="${block.id}" title="Link. Google Drive and Google Docs URLs work well.">Link</button>
      </div>
      <button type="button" class="icon-button report-note-remove" data-remove-note="${block.id}" aria-label="Remove note">×</button>
    </div>
    <div class="rtf-editor report-note-editor" id="report-note-${block.id}" contenteditable="true" role="textbox" aria-label="Report note" data-placeholder="Formatted notes, a pasted screenshot, or a Google Drive / Docs link…" data-report-block="${block.id}">${html}</div>
    ${reportInsertRail(block.slot, block.id)}
  </section>`;
}

function reportSlotMarkup(slot, editing) {
  const notes = blocksForSlot(currentReportLayout().blocks, slot).map((block) => reportNoteMarkup(block, editing)).join("");
  return `${notes}${editing ? reportInsertRail(slot) : ""}`;
}

function reportEngagements(projectIds = []) {
  const included = new Set(projectIds);
  return state.engagements.filter((engagement) => engagement.projectId && included.has(engagement.projectId));
}

function invoiceSettlementState(rows, engagements) {
  const cashEngagements = engagements.filter(engagementIsCashSettlement);
  const cashProjectIds = new Set(cashEngagements.map((engagement) => engagement.projectId));
  const nonCashProjectIds = new Set(engagements
    .filter((engagement) => ["barter", "community-partnership"].includes(normalizeEngagementTerms(engagement.terms)) && !engagementIsCashSettlement(engagement))
    .map((engagement) => engagement.projectId));
  const settledProjectIds = new Set([...cashProjectIds, ...nonCashProjectIds]);
  const taskTotal = rows
    .filter((task) => !settledProjectIds.has(task.projectId))
    .reduce((sum, task) => sum + Number(task.rate || 0), 0);
  const engagementTotal = cashEngagements.reduce((sum, engagement) => sum + engagementCashAmount(engagement), 0);
  const nonCashOnly = engagements.length > 0 && cashEngagements.length === 0 && taskTotal === 0;
  return { total: taskTotal + engagementTotal, taskTotal, engagementTotal, cashEngagements, nonCashOnly };
}

function invoiceEngagementMarkup(engagements) {
  if (!engagements.length) return "";
  return `<section class="invoice-engagements" aria-label="Engagement settlement terms">
    <h3>Engagement terms</h3>
    <div>${engagements.map((engagement) => {
      const cash = engagementIsCashSettlement(engagement);
      const detail = cash ? `${usd(engagement.amount)} USD`
        : normalizeEngagementTerms(engagement.terms) === "barter" ? (engagement.exchangeNote || "Barter exchange not set")
          : normalizeEngagementTerms(engagement.terms) === "community-partnership" ? (engagement.arrangementNote || "Advocacy arrangement not set")
            : "Amount not set";
      return `<article class="invoice-engagement-row ${cash ? "is-cash" : "is-noncash"}"><div><strong>${escapeHtml(engagement.name)}</strong><span>${escapeHtml(engagementTermsLabel(engagement.terms))}</span></div><p>${escapeHtml(detail)}</p></article>`;
    }).join("")}</div>
  </section>`;
}

function reportsView() {
  const selected = includedProjectIds();
  const rows = reportRows(state.tasks, state.report.type, { projectIds: selected });
  const engagements = reportEngagements(selected);
  const settlement = invoiceSettlementState(rows, engagements);
  const labels = {
    invoice: settlement.nonCashOnly
      ? ["Settlement record", "Non-cash arrangements recorded without a cash invoice."]
      : ["Invoice settlement", "Completed work prepared for settlement."],
    project: ["Project manager", "Delivery detail, owners, and operational status."],
    stakeholder: ["Stakeholder pulse", "A concise outcome-oriented portfolio view."]
  };
  const [title, subtitle] = labels[state.report.type];
  const projects = new Set(rows.map((task) => task.project)).size;
  const refineOpen = typeof matchMedia === "function" && matchMedia("(min-width: 801px)").matches;
  const editing = reportEditing();
  const table = rows.length
    ? `<table><thead><tr><th>Work item</th><th>Owner</th>${state.report.showDate || state.report.showTime ? "<th>Reported</th>" : ""}<th>Result</th></tr></thead><tbody>${rows.map((task) => `<tr><td><strong>${escapeHtml(task.title)}</strong>${state.report.showDetails ? `<br><small>${escapeHtml(task.project)}${plainText(task.description) ? ` — ${escapeHtml(plainText(task.description))}` : ""}${task.timestampOverridden ? " · ✎ adjusted" : ""}</small>` : ""}</td><td>${escapeHtml(task.ownerName)}</td>${state.report.showDate || state.report.showTime ? `<td>${formatMoment(task.completedAt || task.createdAt, state.report)}</td>` : ""}<td>${escapeHtml(task.result)}</td></tr>`).join("")}</tbody></table>`
    : `<div class="empty">No work matches this report yet. ${selected.length ? "" : "Select at least one project."}</div>`;
  return `<main class="main">
    <header class="page-head page-head-work"><div><p class="eyebrow">Reports</p><h1 class="page-title">Proof</h1></div></header>
    <section class="report-layout">
      <aside class="report-controls">
        <h3>Report lens</h3>
        <div class="report-types">${Object.entries(labels).map(([id, [label]]) => `<button class="report-type ${state.report.type === id ? "active" : ""}" data-report="${id}">${label}</button>`).join("")}</div>
        <details class="advanced-options report-refine" id="report-refine"${refineOpen ? " open" : ""}>
          <summary>Refine</summary>
          <div class="report-refine-body">
            <h3>Projects</h3>
            <div class="seg" role="group" aria-label="Project selection"><button type="button" class="seg-btn" id="report-all-projects">All</button><button type="button" class="seg-btn" id="report-no-projects">None</button></div>
            <div class="project-checks" id="report-projects">${state.projects.map((project) => `<label class="check-line"><input type="checkbox" data-report-project="${project.id}" ${selected.includes(project.id) ? "checked" : ""}> ${escapeHtml(project.name)}</label>`).join("") || `<p class="hint">No projects yet.</p>`}</div>
            <h3>Display</h3>
            ${[["showDate", "Show dates"], ["showTime", "Show exact times"], ["showDetails", "Task detail"]].map(([key, label]) => `<div class="switch-row"><span>${label}</span><button aria-label="Toggle ${label}" class="switch ${state.report[key] ? "on" : ""}" data-toggle="${key}"><span></span></button></div>`).join("")}
            <p class="hint">Invoice reports start with dates, not exact times.</p>
          </div>
        </details>
      </aside>
      <article class="report-sheet ${editing ? "is-editing" : ""}" data-report-type="${state.report.type}">
        ${editing ? `<div class="report-edit-bar">
          <p class="hint">Add formatted notes, pasted pictures, or Google Drive / Docs links above, between, or below these sections. They stay on this lens after you leave edit mode.</p>
          <button type="button" class="button" id="done-report-edit">Done</button>
        </div>` : ""}
        ${reportSlotMarkup("start", editing)}
        <header class="report-sheet-head">
          <div><p class="mono">LEDGERLANE / ${new Date().getFullYear()}</p><h2>${title}</h2><p>${subtitle}</p></div>
          <div class="report-actions">${actionMenu("report-share", "Share", [
            menuItem("download-report", "Download CSV", "A spreadsheet of the rows on this report"),
            menuItem("print-report", "Print", "Open the print dialog for this sheet")
          ].join(""))}</div>
        </header>
        ${reportSlotMarkup("after-head", editing)}
        <div class="stats">
          <div class="stat"><strong>${rows.length}</strong><small>Items shown</small></div>
          <div class="stat"><strong>${taskProgress(rows)}%</strong><small>Completion</small></div>
          <div class="stat"><strong>${state.report.type === "invoice" ? settlement.nonCashOnly ? "Non-cash" : usd(settlement.total) : projects}</strong><small>${state.report.type === "invoice" ? "Settlement" : "Projects"}</small></div>
        </div>
        ${reportSlotMarkup("after-stats", editing)}
        ${state.report.type === "invoice" ? invoiceEngagementMarkup(engagements) : ""}
        ${table}
        ${reportSlotMarkup("after-table", editing)}
      </article>
    </section>
  </main>`;
}

function bindReportNoteEditor(editor) {
  editor.oninput = () => {
    captureReportEditor(editor);
    scheduleReportSave();
  };
  editor.onpaste = async (event) => {
    const image = [...(event.clipboardData?.items || [])].find((item) => item.type.startsWith("image/"));
    if (image) {
      event.preventDefault();
      await insertReportImage(editor, image.getAsFile());
      return;
    }
    const text = event.clipboardData?.getData("text/plain") || "";
    const pastedHtml = event.clipboardData?.getData("text/html") || "";
    const url = normalizeHttpUrl(text.trim());
    if (!pastedHtml && url && /^https?:\/\//i.test(url)) {
      event.preventDefault();
      insertReportLinkAt(editor, url);
    }
  };
  editor.ondragover = (event) => event.preventDefault();
  editor.ondrop = async (event) => {
    event.preventDefault();
    const files = [...(event.dataTransfer?.files || [])].filter((file) => file.type.startsWith("image/"));
    await Promise.all(files.map((file) => insertReportImage(editor, file)));
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function insertReportImage(editor, file) {
  if (!guardEdit() || !file) return;
  if (!file.type.startsWith("image/")) return;
  if (file.size > REPORT_IMAGE_MAX) return toast("Image is too large to embed in the report");
  const dataUrl = await readFileAsDataUrl(file);
  editor.focus();
  document.execCommand("insertImage", false, dataUrl);
  captureReportEditor(editor);
  await persistReportLayout();
}

function insertReportLinkAt(editor, url, label) {
  const href = normalizeHttpUrl(url);
  if (!href) return toast("Enter a web link, such as a Google Drive or Docs URL");
  editor.focus();
  if (reportLinkContext.range && editor.contains(reportLinkContext.range.commonAncestorContainer)) {
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(reportLinkContext.range);
  }
  const selected = document.getSelection()?.toString().trim();
  const text = selected || label || defaultLinkLabel(href);
  if (selected) document.execCommand("createLink", false, href);
  else document.execCommand("insertHTML", false, `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`);
  editor.querySelectorAll("a[href]").forEach((anchor) => {
    const kind = googleWorkspaceKind(anchor.href);
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
    if (kind === "docs") anchor.classList.add("report-link-docs");
    if (kind === "drive") anchor.classList.add("report-link-drive");
  });
  captureReportEditor(editor);
  persistReportLayout();
  toast(googleWorkspaceKind(href) === "docs" ? "Google Doc linked" : googleWorkspaceKind(href) === "drive" ? "Google Drive linked" : "Link added");
}

function rememberReportSelection(editor) {
  const selection = document.getSelection();
  if (selection?.rangeCount && editor.contains(selection.anchorNode)) {
    reportLinkContext = { editor, range: selection.getRangeAt(0).cloneRange() };
  } else {
    reportLinkContext = { editor, range: null };
  }
}

function openReportLinkDialog(editor) {
  rememberReportSelection(editor);
  const dialog = document.querySelector("#report-link-dialog");
  const form = document.querySelector("#report-link-form");
  form.reset();
  const selected = reportLinkContext.range?.toString().trim() || "";
  form.elements.label.value = selected;
  dialog.showModal();
  form.elements.url.focus();
}

function bindReportLinkDialog() {
  const dialog = document.querySelector("#report-link-dialog");
  const form = document.querySelector("#report-link-form");
  if (!dialog || dialog.dataset.bound) return;
  dialog.dataset.bound = "true";
  document.querySelector("#close-report-link").onclick = document.querySelector("#cancel-report-link").onclick = () => dialog.close();
  form.onsubmit = (event) => {
    event.preventDefault();
    const url = form.elements.url.value;
    const label = form.elements.label.value.trim();
    if (!normalizeHttpUrl(url)) {
      toast("Enter a web link, such as a Google Drive or Docs URL");
      return;
    }
    const editor = reportLinkContext.editor;
    dialog.close();
    if (editor) insertReportLinkAt(editor, url, label);
  };
}

async function addReportBlock(slot, afterId = "") {
  if (!guardEdit()) return;
  if (!state.reportEditing) state.reportEditing = true;
  flushReportEditors();
  const layout = currentReportLayout();
  const block = {
    id: uuid(),
    slot,
    html: "",
    order: nextReportBlockOrder(layout.blocks, slot, afterId || undefined)
  };
  layout.blocks = reindexReportBlocks([...layout.blocks, block]);
  state.reportFocusBlockId = block.id;
  await persistReportLayout();
  render();
}

async function removeReportBlock(id) {
  if (!guardEdit()) return;
  flushReportEditors();
  const layout = currentReportLayout();
  const block = layout.blocks.find((item) => item.id === id);
  if (!block) return;
  if (reportBlockHasContent(block.html)) {
    const ok = await askConfirm({
      title: "Remove this note?",
      message: "The formatted text, pictures, and links in this note will be deleted from the report.",
      confirmLabel: "Remove note"
    });
    if (!ok) return;
  }
  layout.blocks = reindexReportBlocks(layout.blocks.filter((item) => item.id !== id));
  await persistReportLayout();
  render();
}

function bindReports() {
  bindReportLinkDialog();
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
  document.querySelector("#done-report-edit")?.addEventListener("click", () => setReportEditing(false));
  document.querySelectorAll("[data-report-slot]").forEach((button) => {
    button.onclick = () => addReportBlock(button.dataset.reportSlot, button.dataset.after || "");
  });
  document.querySelectorAll("[data-remove-note]").forEach((button) => {
    button.onclick = () => removeReportBlock(button.dataset.removeNote);
  });
  document.querySelectorAll("[data-report-block]").forEach((editor) => bindReportNoteEditor(editor));
  document.querySelectorAll("[data-report-cmd]").forEach((button) => {
    button.onclick = (event) => {
      event.preventDefault();
      const editor = document.querySelector(`[data-report-block="${button.dataset.reportCmd}"]`);
      editor?.focus();
      document.execCommand(button.dataset.cmd, false);
      if (editor) {
        captureReportEditor(editor);
        scheduleReportSave();
      }
    };
  });
  document.querySelectorAll("[data-link]").forEach((button) => {
    button.onclick = (event) => {
      event.preventDefault();
      const editor = document.querySelector(`[data-report-block="${button.dataset.link}"]`);
      if (editor) openReportLinkDialog(editor);
    };
  });
  const focusId = state.reportFocusBlockId;
  state.reportFocusBlockId = null;
  if (focusId) document.querySelector(`[data-report-block="${focusId}"]`)?.focus();
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
  const projectIdMap = new Map();
  const importedProjects = new Map();
  for (const source of parsed.projects || []) {
    if (!source?.name) continue;
    const project = await getOrCreateProject(source.name);
    if (source.id) {
      projectIdMap.set(source.id, project.id);
      importedProjects.set(source.id, project);
    }
  }
  for (const draft of parsed.tasks) {
    const project = importedProjects.get(draft.sourceProjectId) || await getOrCreateProject(draft.project || "Imported");
    if (draft.sourceProjectId) projectIdMap.set(draft.sourceProjectId, project.id);
    state.projects = await all("projects");
    state.columns = await all("columns");
    const column = await ensureImportColumn(project, draft);
    const owner = matchOwner(draft.ownerName);
    const createdAt = draft.createdAt || new Date().toISOString();
    const completedAt = column.type === "complete" ? (draft.completedAt || new Date().toISOString()) : null;
    const tagIds = await ensureTagIds(draft.tagNames || []);
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
      externalId: draft.externalId || "",
      tagIds,
      color: normalizeCardColor(draft.color)
    });
    created += 1;
  }
  const engagementIdMap = new Map();
  for (const source of parsed.engagements || []) {
    const engagement = {
      id: uuid(), name: source.name, terms: normalizeEngagementTerms(source.terms) || "one-time", amount: source.amount,
      exchangeNote: source.exchangeNote || "", arrangementNote: source.arrangementNote || "",
      priorProjectId: projectIdMap.get(source.priorProjectId) || "", projectId: projectIdMap.get(source.projectId) || null,
      createdAt: source.createdAt || new Date().toISOString(), savedAt: source.savedAt || ""
    };
    await put("engagements", engagement);
    if (source.sourceId) engagementIdMap.set(source.sourceId, engagement.id);
  }
  for (const source of parsed.engagementTasks || []) {
    const engagementId = engagementIdMap.get(source.sourceEngagementId);
    if (!engagementId) continue;
    await put("engagementTasks", {
      id: uuid(), engagementId, title: source.title, notes: source.notes || "", timing: source.timing || "undated",
      dueDate: source.dueDate || "", status: source.status || "backlog", sortOrder: source.sortOrder ?? Date.now(),
      createdAt: source.createdAt || new Date().toISOString()
    });
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
  const backup = buildLedgerLaneBackup({
    projects: state.projects, columns: state.columns, tasks: state.tasks, tags: state.tags,
    engagements: state.engagements, engagementTasks: state.engagementTasks
  });
  downloadBlob(`${stamp("ledgerlane-backup")}.json`, new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
  closeExportDialog();
  toast("LedgerLane backup downloaded");
}

function openNotionExport() {
  const visible = visibleTasks();
  const text = buildNotionMarkdown(visible, { projects: state.projects, columns: state.columns, tags: state.tags });
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

function openPeopleDialog() {
  fillPeopleDialog();
  const dialog = document.querySelector("#people-dialog");
  if (!dialog.open) dialog.showModal();
}

function fillPeopleDialog() {
  const list = document.querySelector("#people-list");
  const invite = document.querySelector("#invite-people");
  const empty = document.querySelector("#invite-empty");
  const manage = canManagePeople(state.user, state.members);
  const people = boardPeople();
  list.innerHTML = people.map(({ member, user, name }, index) => {
    const role = normalizeBoardRole(member.role);
    const roleControl = manage
      ? `<label class="people-role"><span class="visually-hidden">Board role for ${escapeHtml(name)}</span><select data-member-role="${member.id}">${BOARD_ROLES.map((item) => `<option value="${item.id}" ${item.id === role ? "selected" : ""}>${item.label}</option>`).join("")}</select></label>`
      : `<span class="people-role-label">${escapeHtml(roleCaption({ role }))}</span>`;
    const remove = manage && canRemoveMember(state.user, member, state.members)
      ? `<button type="button" class="button ghost danger" data-remove-member="${member.id}">Remove</button>`
      : "";
    return `<li class="people-row" data-member="${member.id}"><span class="face face-${(index % 3) + 1}">${escapeHtml(initials(name))}</span><div><strong>${escapeHtml(name)}</strong>${user.id === state.user.id ? "<small>You</small>" : ""}</div>${roleControl}${remove}</li>`;
  }).join("");
  const guests = invitableUsers(state.users, state.members);
  if (manage && guests.length) {
    invite.hidden = false;
    empty.hidden = true;
    document.querySelector("#invite-user").innerHTML = guests.map((user) => `<option value="${user.id}">${escapeHtml(user.name)}</option>`).join("");
  } else {
    invite.hidden = true;
    invite.open = false;
    empty.hidden = !manage;
  }
  list.querySelectorAll("[data-member-role]").forEach((select) => {
    select.onchange = async () => {
      if (!guardManage()) return;
      const member = state.members.find((item) => item.id === select.dataset.memberRole);
      if (!member || !canAssignRole(state.user, member, select.value, state.members)) {
        select.value = member ? normalizeBoardRole(member.role) : "editor";
        toast("Keep at least one admin");
        return;
      }
      member.role = normalizeBoardRole(select.value);
      await put("members", member);
      toast("Role updated");
      await refresh();
    };
  });
  list.querySelectorAll("[data-remove-member]").forEach((button) => {
    button.onclick = async () => {
      const member = state.members.find((item) => item.id === button.dataset.removeMember);
      const user = state.users.find((item) => item.id === member?.userId);
      if (!member || !guardManage() || !canRemoveMember(state.user, member, state.members)) return;
      const ok = await askConfirm({
        title: "Remove from board?",
        message: `${user?.name || "This person"} stays on this device but loses board access until invited again.`,
        confirmLabel: "Remove"
      });
      if (!ok) return;
      await remove("members", member.id);
      toast("Removed from the board");
      if (member.userId === state.user.id) document.querySelector("#people-dialog")?.close();
      await refresh();
    };
  });
}

async function invitePerson() {
  if (!guardManage()) return;
  const userId = document.querySelector("#invite-user").value;
  const role = normalizeBoardRole(document.querySelector("#invite-role").value);
  if (!userId || memberFor(userId, state.members)) return;
  await put("members", {
    id: uuid(),
    userId,
    role,
    invitedBy: state.user.id,
    createdAt: new Date().toISOString()
  });
  document.querySelector("#invite-people").open = false;
  toast("Invited to the board");
  await refresh();
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
  document.querySelector("#close-people").onclick = document.querySelector("#done-people").onclick = () => document.querySelector("#people-dialog").close();
  document.querySelector("#confirm-invite-person").onclick = invitePerson;
  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-menu]")) closeActionMenus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeActionMenus();
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target.closest?.("input, textarea, select, [contenteditable='true']")) return;
    if (document.querySelector("dialog[open]")) return;
    if (!state.user || !canAccessBoard(state.user, state.members)) return;
    if (event.key === "/") {
      event.preventDefault();
      if (state.view !== "board") {
        state.view = "board";
        render();
      }
      document.querySelector("#search")?.focus();
      return;
    }
    if (event.key === "n" && canEdit()) {
      event.preventDefault();
      if (state.view !== "board") {
        state.view = "board";
        render();
      }
      openTask();
    }
  });
}

bindGlobalChrome();
refresh().catch((error) => { root.innerHTML = `<p class="auth-error">Unable to open local storage: ${escapeHtml(error.message)}</p>`; });
