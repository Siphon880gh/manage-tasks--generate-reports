export const STATUSES = ["backlog", "progress", "done"];

export function formatMoment(value, { showDate = true, showTime = false } = {}) {
  if (!value || (!showDate && !showTime)) return "Hidden";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = [];
  if (showDate) parts.push(new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date));
  if (showTime) parts.push(new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(date));
  return parts.join(" · ");
}

export function taskProgress(tasks) {
  if (!tasks.length) return 0;
  return Math.round(tasks.filter((task) => task.status === "done").length / tasks.length * 100);
}

export function filterTasks(tasks, { query = "", owner = "all", project = "all" } = {}) {
  const needle = query.trim().toLowerCase();
  return tasks.filter((task) => {
    const text = `${task.title} ${task.project} ${task.ownerName} ${task.description || ""}`.toLowerCase();
    return (!needle || text.includes(needle)) && (owner === "all" || task.ownerId === owner) && (project === "all" || task.project === project);
  });
}

export function reportRows(tasks, type) {
  if (type === "invoice") return tasks.filter((task) => task.status === "done").map((task) => ({ ...task, result: task.rate ? `$${Number(task.rate).toLocaleString()}` : "Ready" }));
  if (type === "stakeholder") return tasks.map((task) => ({ ...task, result: task.status === "done" ? "Delivered" : task.status === "progress" ? "In flight" : "Planned" }));
  return tasks.map((task) => ({ ...task, result: task.status === "done" ? "Complete" : task.priority }));
}

export function toCsv(rows, columns) {
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [columns.map((column) => quote(column.label)).join(","), ...rows.map((row) => columns.map((column) => quote(column.value(row))).join(","))].join("\n");
}

