import { STATUSES, filterTasks, formatMoment, reportRows, taskProgress, toCsv } from "./app-core.mjs";

const DB_NAME = "ledgerlane-db";
const state = { user: null, users: [], tasks: [], view: "board", authMode: "signup", filters: { query: "", owner: "all", project: "all" }, report: { type: "invoice", showDate: true, showTime: false, showDetails: true } };
const root = document.querySelector("#app");

const dbPromise = new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains("users")) db.createObjectStore("users", { keyPath: "id" }).createIndex("username", "username", { unique: true });
    if (!db.objectStoreNames.contains("tasks")) db.createObjectStore("tasks", { keyPath: "id" });
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
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]);
const initials = (name) => name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
const localDateTime = (iso) => iso ? new Date(iso).toISOString().slice(0, 16) : "";
const uuid = () => crypto.randomUUID();

async function hash(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toast(message) {
  const el = document.querySelector("#toast");
  el.textContent = message; el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}

async function refresh() {
  state.users = await all("users"); state.tasks = await all("tasks");
  const id = localStorage.getItem("ledgerlane-session");
  state.user = state.users.find((u) => u.id === id) || null;
  render();
}

function renderAuth(error = "") {
  root.innerHTML = `<main class="auth-page"><section class="auth-art"><div class="brand"><span class="brand-mark">LL</span> LEDGERLANE</div><h1>WORK,<br>ACCOUNTED<br>FOR.</h1><div><p class="statement">A local-first workspace for turning progress into proof — without sending your data anywhere.</p><p class="mono">PRIVATE BY DEFAULT / LOCAL BY DESIGN</p></div></section><section class="auth-card"><form id="auth-form"><div class="auth-tabs"><button type="button" data-auth="signup" class="${state.authMode === "signup" ? "active" : ""}">Create account</button><button type="button" data-auth="login" class="${state.authMode === "login" ? "active" : ""}">Sign in</button></div><p class="eyebrow">Local workspace</p><h2>${state.authMode === "signup" ? "Start your ledger." : "Welcome back."}</h2><p class="hint">Accounts live only in this browser on this computer.</p>${error ? `<p class="auth-error">${escapeHtml(error)}</p>` : ""}<div class="form" style="padding:24px 0">${state.authMode === "signup" ? `<div class="field"><label for="name">Display name</label><input id="name" name="name" required placeholder="e.g. Morgan Lee"></div>` : ""}<div class="field"><label for="username">Username</label><input id="username" name="username" required autocomplete="username" placeholder="morgan"></div><div class="field"><label for="password">Passphrase</label><input id="password" name="password" type="password" minlength="6" required autocomplete="${state.authMode === "signup" ? "new-password" : "current-password"}" placeholder="At least 6 characters"></div><button class="button primary" type="submit">${state.authMode === "signup" ? "Create local account →" : "Enter workspace →"}</button></div></form></section></main>`;
  document.querySelectorAll("[data-auth]").forEach((button) => button.onclick = () => { state.authMode = button.dataset.auth; renderAuth(); });
  document.querySelector("#auth-form").onsubmit = handleAuth;
}

async function handleAuth(event) {
  event.preventDefault(); const data = new FormData(event.currentTarget);
  const username = data.get("username").trim().toLowerCase(); const passwordHash = await hash(data.get("password"));
  if (state.authMode === "signup") {
    if (state.users.some((u) => u.username === username)) return renderAuth("That username already exists on this device.");
    const user = { id: uuid(), name: data.get("name").trim(), username, passwordHash, createdAt: new Date().toISOString() };
    await put("users", user); await seedTasks(user); localStorage.setItem("ledgerlane-session", user.id);
  } else {
    const user = state.users.find((u) => u.username === username && u.passwordHash === passwordHash);
    if (!user) return renderAuth("Username or passphrase did not match.");
    localStorage.setItem("ledgerlane-session", user.id);
  }
  await refresh();
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
  await Promise.all(seeds.map(async ([title, project, priority, status, rate, days]) => {
    const createdAt = new Date(now + days * 86400000).toISOString();
    await put("tasks", { id: uuid(), title, project, priority, status, rate, ownerId: user.id, ownerName: user.name, description: "Seeded workspace task — edit or remove it at any time.", createdAt, completedAt: status === "done" ? new Date(now + (days + 2) * 86400000).toISOString() : null, timestampOverridden: false });
  }));
}

function shell(content) {
  return `<div class="app-shell"><header class="topbar"><div class="brand"><span class="brand-mark">LL</span> LEDGERLANE</div><nav class="main-nav"><button class="nav-btn ${state.view === "board" ? "active" : ""}" data-view="board">Board</button><button class="nav-btn ${state.view === "reports" ? "active" : ""}" data-view="reports">Reports</button></nav><div class="account-area"><span class="account-name"><strong>${escapeHtml(state.user.name)}</strong><br><small class="mono">Local account</small></span><button class="avatar" id="account-button" title="Sign out">${initials(state.user.name)}</button></div></header>${content}<nav class="mobile-nav"><button class="${state.view === "board" ? "active" : ""}" data-view="board">▦ BOARD</button><button class="${state.view === "reports" ? "active" : ""}" data-view="reports">▤ REPORTS</button></nav></div>`;
}

function render() {
  if (!state.user) return renderAuth();
  root.innerHTML = shell(state.view === "board" ? boardView() : reportsView());
  document.querySelectorAll("[data-view]").forEach((b) => b.onclick = () => { state.view = b.dataset.view; render(); });
  document.querySelector("#account-button").onclick = () => { if (confirm(`Sign out ${state.user.name}?`)) { localStorage.removeItem("ledgerlane-session"); state.user = null; render(); } };
  state.view === "board" ? bindBoard() : bindReports();
}

function boardView() {
  const visible = filterTasks(state.tasks, state.filters);
  const columns = [{ id: "backlog", name: "To do" }, { id: "progress", name: "In progress" }, { id: "done", name: "Complete" }];
  const projects = [...new Set(state.tasks.map((t) => t.project))].sort();
  return `<main class="main"><header class="page-head"><div><p class="eyebrow">Workspace / Delivery board</p><h1>Move the work.<br><em>Keep the proof.</em></h1></div><button class="button acid" id="new-task">＋ New task</button></header><section class="toolbar" aria-label="Board filters"><input class="search" id="search" value="${escapeHtml(state.filters.query)}" placeholder="⌕ Search tasks or projects…"><select class="select" id="owner-filter"><option value="all">All owners</option>${state.users.map((u) => `<option value="${u.id}" ${state.filters.owner === u.id ? "selected" : ""}>${escapeHtml(u.name)}</option>`)}</select><select class="select" id="project-filter"><option value="all">All projects</option>${projects.map((p) => `<option ${state.filters.project === p ? "selected" : ""}>${escapeHtml(p)}</option>`)}</select></section><section class="kanban">${columns.map((column) => { const tasks = visible.filter((t) => t.status === column.id); return `<div class="column" data-drop="${column.id}"><header class="column-head"><h2>${column.name}</h2><span class="count">${tasks.length}</span></header><div class="card-list">${tasks.length ? tasks.map(taskCard).join("") : `<div class="empty">Drop work here</div>`}</div></div>`; }).join("")}</section></main>${taskDialog()}`;
}

function taskCard(task) {
  return `<article class="task-card" draggable="true" data-id="${task.id}" tabindex="0"><span class="tag ${task.priority}">${escapeHtml(task.priority)} priority</span><h3>${escapeHtml(task.title)}</h3><p class="project">${escapeHtml(task.project)}</p><footer class="card-meta"><span class="mini-avatar">${initials(task.ownerName)}</span><span>${task.status === "done" ? "Done " : "Created "}${formatMoment(task.status === "done" ? task.completedAt : task.createdAt, { showDate: true })}${task.timestampOverridden ? " · ✎" : ""}</span></footer></article>`;
}

function taskDialog() {
  return `<dialog id="task-dialog"><form id="task-form"><header class="modal-head"><h2 id="dialog-title">New task</h2><button class="icon-button" type="button" id="close-dialog">×</button></header><div class="form"><input type="hidden" name="id"><div class="field"><label>Task title</label><input name="title" required placeholder="What needs to happen?"></div><div class="form-grid"><div class="field"><label>Project</label><input name="project" required placeholder="Project name"></div><div class="field"><label>Owner</label><select name="ownerId">${state.users.map((u) => `<option value="${u.id}">${escapeHtml(u.name)}</option>`)}</select></div><div class="field"><label>Status</label><select name="status">${STATUSES.map((s) => `<option value="${s}">${s === "progress" ? "In progress" : s}</option>`)}</select></div><div class="field"><label>Priority</label><select name="priority"><option>low</option><option selected>medium</option><option>high</option></select></div></div><div class="field"><label>Description / evidence</label><textarea name="description" placeholder="Context, outputs, or approval notes"></textarea></div><div class="form-grid"><div class="field"><label>Created date & time</label><input type="datetime-local" name="createdAt" required></div><div class="field"><label>Completed date & time</label><input type="datetime-local" name="completedAt"></div></div><p class="hint">✎ Changing these timestamps marks this task as manually adjusted in reports.</p><div class="field"><label>Settlement amount (USD)</label><input type="number" min="0" step="1" name="rate" placeholder="0"></div></div><footer class="form-actions"><button class="button ghost danger" type="button" id="delete-task" hidden>Delete</button><button class="button" type="button" id="cancel-task">Cancel</button><button class="button primary" type="submit">Save task</button></footer></form></dialog>`;
}

function bindBoard() {
  const dialog = document.querySelector("#task-dialog");
  document.querySelector("#new-task").onclick = () => openTask();
  document.querySelector("#close-dialog").onclick = document.querySelector("#cancel-task").onclick = () => dialog.close();
  document.querySelector("#task-form").onsubmit = saveTask;
  document.querySelector("#delete-task").onclick = deleteTask;
  document.querySelectorAll(".task-card").forEach((card) => { card.onclick = () => openTask(card.dataset.id); card.ondragstart = (e) => { card.classList.add("dragging"); e.dataTransfer.setData("text/plain", card.dataset.id); }; card.ondragend = () => card.classList.remove("dragging"); });
  document.querySelectorAll("[data-drop]").forEach((column) => { column.ondragover = (e) => e.preventDefault(); column.ondrop = async (e) => { e.preventDefault(); const task = state.tasks.find((t) => t.id === e.dataTransfer.getData("text/plain")); if (!task) return; task.status = column.dataset.drop; task.completedAt = task.status === "done" ? (task.completedAt || new Date().toISOString()) : null; await put("tasks", task); toast("Task moved"); await refresh(); }; });
  document.querySelector("#search").oninput = (e) => { state.filters.query = e.target.value; render(); document.querySelector("#search").focus(); };
  document.querySelector("#owner-filter").onchange = (e) => { state.filters.owner = e.target.value; render(); };
  document.querySelector("#project-filter").onchange = (e) => { state.filters.project = e.target.value; render(); };
}

function openTask(id) {
  const dialog = document.querySelector("#task-dialog"), form = document.querySelector("#task-form"), task = state.tasks.find((t) => t.id === id);
  form.reset(); form.elements.id.value = task?.id || ""; form.elements.title.value = task?.title || ""; form.elements.project.value = task?.project || ""; form.elements.ownerId.value = task?.ownerId || state.user.id; form.elements.status.value = task?.status || "backlog"; form.elements.priority.value = task?.priority || "medium"; form.elements.description.value = task?.description || ""; form.elements.createdAt.value = localDateTime(task?.createdAt || new Date().toISOString()); form.elements.completedAt.value = localDateTime(task?.completedAt); form.elements.rate.value = task?.rate || "";
  document.querySelector("#dialog-title").textContent = task ? "Edit task" : "New task"; document.querySelector("#delete-task").hidden = !task; dialog.showModal();
}

async function saveTask(event) {
  event.preventDefault(); const data = new FormData(event.currentTarget), old = state.tasks.find((t) => t.id === data.get("id")), owner = state.users.find((u) => u.id === data.get("ownerId"));
  const createdAt = new Date(data.get("createdAt")).toISOString(); const completedAt = data.get("completedAt") ? new Date(data.get("completedAt")).toISOString() : (data.get("status") === "done" ? (old?.completedAt || new Date().toISOString()) : null);
  const task = { id: old?.id || uuid(), title: data.get("title").trim(), project: data.get("project").trim(), ownerId: owner.id, ownerName: owner.name, status: data.get("status"), priority: data.get("priority"), description: data.get("description").trim(), rate: Number(data.get("rate")) || 0, createdAt, completedAt, timestampOverridden: old ? old.createdAt !== createdAt || old.completedAt !== completedAt || old.timestampOverridden : createdAt.slice(0, 16) !== new Date().toISOString().slice(0, 16) };
  await put("tasks", task); document.querySelector("#task-dialog").close(); toast(old ? "Task updated" : "Task created"); await refresh();
}

async function deleteTask() { const id = document.querySelector("#task-form").elements.id.value; if (id && confirm("Delete this task permanently?")) { await remove("tasks", id); document.querySelector("#task-dialog").close(); toast("Task deleted"); await refresh(); } }

function reportsView() {
  const labels = { invoice: ["Invoice settlement", "Completed work prepared for settlement."], project: ["Project manager", "Delivery detail, owners, and operational status."], stakeholder: ["Stakeholder pulse", "A concise outcome-oriented portfolio view."] }, [title, subtitle] = labels[state.report.type];
  const rows = reportRows(state.tasks, state.report.type), total = rows.reduce((sum, t) => sum + Number(t.rate || 0), 0), projects = new Set(rows.map((t) => t.project)).size;
  return `<main class="main"><header class="page-head"><div><p class="eyebrow">Workspace / Reports</p><h1>Turn progress<br>into <em>proof.</em></h1></div></header><section class="report-layout"><aside class="report-controls"><h3>Report lens</h3><div class="report-types">${Object.entries(labels).map(([id, [label]]) => `<button class="report-type ${state.report.type === id ? "active" : ""}" data-report="${id}">${label}</button>`).join("")}</div><h3>Display controls</h3>${[["showDate", "Show dates"], ["showTime", "Show exact times"], ["showDetails", "Task detail"]].map(([key, label]) => `<div class="switch-row"><span>${label}</span><button aria-label="Toggle ${label}" class="switch ${state.report[key] ? "on" : ""}" data-toggle="${key}"><span></span></button></div>`).join("")}<p class="hint" style="margin-top:22px">Invoice reports default to dates without exact times. Adjustments apply instantly.</p></aside><article class="report-sheet"><header class="report-sheet-head"><div><p class="mono">LEDGERLANE / ${new Date().getFullYear()}</p><h2>${title}</h2><p>${subtitle}</p></div><div class="report-actions"><button class="button" id="download-report">↓ CSV</button><button class="button primary" id="print-report">Print</button></div></header><div class="stats"><div class="stat"><strong>${rows.length}</strong><small>Items shown</small></div><div class="stat"><strong>${taskProgress(rows)}%</strong><small>Completion</small></div><div class="stat"><strong>${state.report.type === "invoice" ? `$${total.toLocaleString()}` : projects}</strong><small>${state.report.type === "invoice" ? "Settlement" : "Projects"}</small></div></div>${rows.length ? `<table><thead><tr><th>Work item</th><th>Owner</th>${state.report.showDate || state.report.showTime ? "<th>Reported</th>" : ""}<th>Result</th></tr></thead><tbody>${rows.map((t) => `<tr><td><strong>${escapeHtml(t.title)}</strong>${state.report.showDetails ? `<br><small>${escapeHtml(t.project)}${t.description ? ` — ${escapeHtml(t.description)}` : ""}${t.timestampOverridden ? " · ✎ adjusted" : ""}</small>` : ""}</td><td>${escapeHtml(t.ownerName)}</td>${state.report.showDate || state.report.showTime ? `<td>${formatMoment(t.completedAt || t.createdAt, state.report)}</td>` : ""}<td>${escapeHtml(t.result)}</td></tr>`).join("")}</tbody></table>` : `<div class="empty">No work matches this report yet.</div>`}</article></section></main>`;
}

function bindReports() {
  document.querySelectorAll("[data-report]").forEach((b) => b.onclick = () => { state.report.type = b.dataset.report; if (b.dataset.report === "invoice") state.report.showTime = false; render(); });
  document.querySelectorAll("[data-toggle]").forEach((b) => b.onclick = () => { state.report[b.dataset.toggle] = !state.report[b.dataset.toggle]; render(); });
  document.querySelector("#print-report").onclick = () => print();
  document.querySelector("#download-report").onclick = () => { const rows = reportRows(state.tasks, state.report.type); const columns = [{ label: "Task", value: (r) => r.title }, { label: "Project", value: (r) => r.project }, { label: "Owner", value: (r) => r.ownerName }, ...(state.report.showDate || state.report.showTime ? [{ label: "Reported", value: (r) => formatMoment(r.completedAt || r.createdAt, state.report) }] : []), { label: "Result", value: (r) => r.result }]; const blob = new Blob([toCsv(rows, columns)], { type: "text/csv" }); const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `ledgerlane-${state.report.type}.csv` }); link.click(); URL.revokeObjectURL(link.href); toast("Report downloaded"); };
}

refresh().catch((error) => { root.innerHTML = `<p class="auth-error">Unable to open local storage: ${escapeHtml(error.message)}</p>`; });
