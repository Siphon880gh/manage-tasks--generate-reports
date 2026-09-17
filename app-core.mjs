export const STATUSES = ["backlog", "progress", "done"];

export const COLUMN_TYPES = [
  { id: "todo", label: "To do", status: "backlog", unique: false },
  { id: "progress", label: "In progress", status: "progress", unique: false },
  { id: "complete", label: "Complete", status: "done", unique: true }
];

export const DEFAULT_COLUMNS = [
  { name: "To do", type: "todo" },
  { name: "In progress", type: "progress" },
  { name: "Complete", type: "complete" }
];

export function columnTypeToStatus(type) {
  return COLUMN_TYPES.find((item) => item.id === type)?.status || "backlog";
}

export function statusToColumnType(status) {
  return COLUMN_TYPES.find((item) => item.status === status)?.id || "todo";
}

export function canAddColumnType(columns, type) {
  const spec = COLUMN_TYPES.find((item) => item.id === type);
  if (!spec) return false;
  if (!spec.unique) return true;
  return !columns.some((column) => column.type === type);
}

export function availableColumnTypes(columns) {
  return COLUMN_TYPES.filter((item) => canAddColumnType(columns, item.id));
}

export function availableColumnTypesForEdit(columns, column) {
  return COLUMN_TYPES.filter((item) => item.id === column?.type || canAddColumnType(columns, item.id));
}

export function canDeleteColumn(columns = []) {
  return columns.length > 1;
}

export function destinationAfterColumnDelete(columns = [], columnId) {
  const remaining = columns
    .filter((column) => column.id !== columnId)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (!remaining.length) return null;
  const gone = columns.find((column) => column.id === columnId);
  return remaining.find((column) => column.type === gone?.type) || remaining[0];
}

export function confirmDeleteColumnMessage(name, taskCount = 0, destName = "") {
  if (!taskCount) return `Delete column ${name}? This cannot be undone.`;
  const noun = taskCount === 1 ? "task" : "tasks";
  return `Delete column ${name}? ${taskCount} ${noun} will move to ${destName}.`;
}

export function isViewer(user) {
  return Boolean(user && user.role === "viewer");
}

export function isAdmin(user) {
  return Boolean(user && user.role === "admin");
}

export function accountRole(user) {
  if (!user) return null;
  if (user.role === "viewer") return "viewer";
  if (user.role === "admin") return "admin";
  return "editor";
}

export function roleCaption(user) {
  const role = accountRole(user);
  if (role === "viewer") return "View only";
  if (role === "admin") return "Admin";
  return "Editor";
}

export function canEdit(user) {
  return Boolean(user) && !isViewer(user);
}

export const BOARD_ROLES = [
  { id: "admin", label: "Admin", hint: "Manage people and edit work" },
  { id: "editor", label: "Editor", hint: "Create and change work" },
  { id: "viewer", label: "View only", hint: "See the board, no edits" }
];

export function normalizeBoardRole(role) {
  if (role === "admin" || role === "viewer") return role;
  return "editor";
}

export function memberFor(userId, members = []) {
  return members.find((member) => member.userId === userId) || null;
}

export function boardRole(user, members = []) {
  if (!user) return null;
  const member = memberFor(user.id, members);
  return member ? normalizeBoardRole(member.role) : null;
}

export function canAccessBoard(user, members = []) {
  return Boolean(boardRole(user, members));
}

export function canEditBoard(user, members = []) {
  const role = boardRole(user, members);
  return role === "admin" || role === "editor";
}

export function canManagePeople(user, members = []) {
  return boardRole(user, members) === "admin";
}

export function adminCount(members = []) {
  return members.filter((member) => normalizeBoardRole(member.role) === "admin").length;
}

export function canRemoveMember(actor, target, members = []) {
  if (!canManagePeople(actor, members) || !target) return false;
  if (normalizeBoardRole(target.role) === "admin" && adminCount(members) <= 1) return false;
  return true;
}

export function canAssignRole(actor, target, nextRole, members = []) {
  if (!canManagePeople(actor, members) || !target) return false;
  if (normalizeBoardRole(target.role) === "admin" && normalizeBoardRole(nextRole) !== "admin" && adminCount(members) <= 1) {
    return false;
  }
  return true;
}

export function invitableUsers(users = [], members = []) {
  const taken = new Set(members.map((member) => member.userId));
  return users.filter((user) => !taken.has(user.id));
}

export function seedMemberships(users = []) {
  if (!users.length) return [];
  const members = users.map((user) => ({
    id: `member-${user.id}`,
    userId: user.id,
    role: normalizeBoardRole(user.role),
    invitedBy: null,
    createdAt: user.createdAt || ""
  }));
  if (members.some((member) => member.role === "admin")) return members;
  const promote = members.find((member) => member.role === "editor") || members[0];
  return members.map((member) => member.userId === promote.userId ? { ...member, role: "admin" } : member);
}

export function formatMoment(value, { showDate = true, showTime = false } = {}) {
  if (!value || (!showDate && !showTime)) return "Hidden";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = [];
  if (showDate) parts.push(new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date));
  if (showTime) parts.push(new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(date));
  return parts.join(" · ");
}

export function plainText(value = "") {
  return String(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function taskProgress(tasks) {
  if (!tasks.length) return 0;
  return Math.round(tasks.filter((task) => task.status === "done").length / tasks.length * 100);
}

export function filterTasks(tasks, { query = "", owner = "all", project = "all" } = {}) {
  const needle = query.trim().toLowerCase();
  return tasks.filter((task) => {
    const text = `${task.title} ${task.project} ${task.ownerName} ${plainText(task.description)}`.toLowerCase();
    const projectMatch = project === "all" || task.projectId === project || task.project === project;
    return (!needle || text.includes(needle)) && (owner === "all" || task.ownerId === owner) && projectMatch;
  });
}

export function filterByProjectIds(tasks, projectIds) {
  if (!projectIds) return tasks;
  if (!projectIds.length) return [];
  const set = new Set(projectIds);
  return tasks.filter((task) => set.has(task.projectId) || set.has(task.project));
}

export function reportRows(tasks, type, options = {}) {
  const scoped = filterByProjectIds(tasks, options.projectIds);
  if (type === "invoice") return scoped.filter((task) => task.status === "done").map((task) => ({ ...task, result: task.rate ? `$${Number(task.rate).toLocaleString()}` : "Ready" }));
  if (type === "stakeholder") return scoped.map((task) => ({ ...task, result: task.status === "done" ? "Delivered" : task.status === "progress" ? "In flight" : "Planned" }));
  return scoped.map((task) => ({ ...task, result: task.status === "done" ? "Complete" : task.priority }));
}

export function toCsv(rows, columns) {
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [columns.map((column) => quote(column.label)).join(","), ...rows.map((row) => columns.map((column) => quote(column.value(row))).join(","))].join("\n");
}

export function sortTasks(tasks) {
  return [...tasks].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}

export function applyDropOrder(columnTasks, movedId, insertIndex) {
  const moved = columnTasks.find((task) => task.id === movedId);
  if (!moved) return columnTasks;
  const without = columnTasks.filter((task) => task.id !== movedId);
  const next = [...without];
  next.splice(Math.max(0, Math.min(insertIndex, next.length)), 0, moved);
  return next.map((task, index) => ({ ...task, sortOrder: (index + 1) * 10 }));
}

export function confirmDeleteMessage(count, scopeLabel = "") {
  const noun = count === 1 ? "task" : "tasks";
  const scope = scopeLabel ? ` ${scopeLabel}` : "";
  return `Delete ${count} ${noun}${scope}? This cannot be undone.`;
}

export function naturalJoin(names, empty = "a board admin") {
  const clean = (names || []).map((name) => String(name || "").trim()).filter(Boolean);
  if (!clean.length) return empty;
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} or ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, or ${clean[clean.length - 1]}`;
}
