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

export function isViewer(user) {
  return Boolean(user && user.role === "viewer");
}

export function canEdit(user) {
  return Boolean(user) && !isViewer(user);
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
