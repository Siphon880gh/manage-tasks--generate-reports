export const STATUSES = ["backlog", "progress", "done"];

export const ENGAGEMENT_TERMS = [
  { id: "one-time", label: "One-time", hint: "Fixed fee / single settlement" },
  { id: "retainer", label: "Retainer", hint: "Ongoing, recurring arrangement" },
  { id: "barter", label: "Barter", hint: "In-kind exchange" },
  { id: "community-partnership", label: "Community partnership", hint: "Advocacy / community-advocate deal" }
];

export function normalizeEngagementTerms(value) {
  const id = String(value || "").trim().toLowerCase();
  return ENGAGEMENT_TERMS.some((term) => term.id === id) ? id : "";
}

export function engagementTermsLabel(value) {
  const id = normalizeEngagementTerms(value);
  return ENGAGEMENT_TERMS.find((term) => term.id === id)?.label || "Terms not set";
}

export function engagementCashAmount(engagement = {}) {
  const amount = Number(engagement.amount);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

export function engagementIsCashSettlement(engagement = {}) {
  const terms = normalizeEngagementTerms(engagement.terms);
  return Boolean(engagementCashAmount(engagement))
    && ["one-time", "retainer", "barter", "community-partnership"].includes(terms);
}

export function engagementWorkTimingLabel(task = {}) {
  if (task.timing === "ongoing") return "Ongoing";
  if (task.timing === "date" && task.dueDate) {
    const date = new Date(`${task.dueDate}T12:00:00`);
    if (!Number.isNaN(date.getTime())) return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
  }
  return "Undated";
}

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

export const CARD_COLORS = [
  { id: "none", label: "None", fill: "#fffefa" },
  { id: "acid", label: "Acid", fill: "#eef6b8" },
  { id: "blue", label: "Blue", fill: "#d7e2ff" },
  { id: "coral", label: "Coral", fill: "#ffdcd3" },
  { id: "gold", label: "Gold", fill: "#ffe08a" },
  { id: "sage", label: "Sage", fill: "#d7ead0" }
];

export function normalizeCardColor(value) {
  const id = String(value || "none").trim() || "none";
  return CARD_COLORS.some((color) => color.id === id) ? id : "none";
}

export function cardColorMeta(value) {
  const id = normalizeCardColor(value);
  return CARD_COLORS.find((color) => color.id === id) || CARD_COLORS[0];
}

export function normalizeTagName(value = "") {
  return String(value).replace(/\s+/g, " ").trim().slice(0, 32);
}

export function normalizeTagIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((id) => String(id || "").trim()).filter(Boolean))];
}

export function findTagByName(tags = [], name) {
  const needle = normalizeTagName(name).toLowerCase();
  if (!needle) return null;
  return tags.find((tag) => normalizeTagName(tag.name).toLowerCase() === needle) || null;
}

export function toggleListValue(list = [], value) {
  const current = Array.isArray(list) ? [...list] : [];
  const key = String(value);
  const index = current.findIndex((item) => String(item) === key);
  if (index >= 0) current.splice(index, 1);
  else current.push(key);
  return current;
}

export function emptyBoardFilters() {
  return { query: "", owner: "all", project: "all", tags: [], colors: [] };
}

export function boardFiltersActive(filters = {}) {
  return Boolean(
    String(filters.query || "").trim()
    || (filters.owner && filters.owner !== "all")
    || (filters.project && filters.project !== "all")
    || (Array.isArray(filters.tags) && filters.tags.length)
    || (Array.isArray(filters.colors) && filters.colors.length)
  );
}

export function taskMatchesTags(task, tagIds = []) {
  const wanted = normalizeTagIds(tagIds);
  if (!wanted.length) return true;
  const have = new Set(normalizeTagIds(task?.tagIds));
  return wanted.some((id) => have.has(id));
}

export function taskMatchesColors(task, colors = []) {
  const wanted = [...new Set((Array.isArray(colors) ? colors : []).map(normalizeCardColor))];
  if (!wanted.length) return true;
  return wanted.includes(normalizeCardColor(task?.color));
}

export function filterTasks(tasks, {
  query = "", owner = "all", project = "all", tags = [], colors = [], tagCatalog = []
} = {}) {
  const needle = query.trim().toLowerCase();
  const namesById = new Map((tagCatalog || []).map((tag) => [tag.id, tag.name]));
  return tasks.filter((task) => {
    const tagNames = normalizeTagIds(task.tagIds).map((id) => namesById.get(id) || "").join(" ");
    const text = `${task.title} ${task.project} ${task.ownerName} ${plainText(task.description)} ${tagNames}`.toLowerCase();
    const projectMatch = project === "all" || task.projectId === project || task.project === project;
    return (!needle || text.includes(needle))
      && (owner === "all" || task.ownerId === owner)
      && projectMatch
      && taskMatchesTags(task, tags)
      && taskMatchesColors(task, colors);
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

export function settlementAssets(task = {}) {
  const stored = Array.isArray(task.settlementAssets) ? task.settlementAssets : [];
  return stored.map((asset) => ({
    name: String(asset?.name || "").trim(),
    url: normalizeHttpUrl(asset?.url || "")
  })).filter((asset) => asset.url);
}

export function settlementHours(task = {}) {
  const hours = Number(task.settlementHours);
  return Number.isFinite(hours) && hours > 0 ? hours : 0;
}

export const REPORT_TYPES = ["invoice", "project", "stakeholder"];

export const REPORT_SLOTS = [
  { id: "start", label: "above the title" },
  { id: "after-head", label: "below the title" },
  { id: "after-stats", label: "between the summary and work items" },
  { id: "after-table", label: "below the work items" }
];

export function emptyReportLayouts() {
  return Object.fromEntries(REPORT_TYPES.map((id) => [id, { id, blocks: [] }]));
}

export function normalizeReportBlocks(blocks = []) {
  const slots = new Set(REPORT_SLOTS.map((slot) => slot.id));
  return (Array.isArray(blocks) ? blocks : [])
    .filter((block) => block && slots.has(block.slot) && block.id)
    .map((block, index) => ({
      id: String(block.id),
      slot: block.slot,
      html: String(block.html || ""),
      order: Number.isFinite(Number(block.order)) ? Number(block.order) : (index + 1) * 10
    }))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function reindexReportBlocks(blocks = []) {
  return REPORT_SLOTS.flatMap((slot) => blocksForSlot(blocks, slot.id).map((block, index) => ({
    ...block,
    order: (index + 1) * 10
  })));
}

export function blocksForSlot(blocks, slot) {
  return normalizeReportBlocks(blocks).filter((block) => block.slot === slot);
}

export function nextReportBlockOrder(blocks, slot, afterId) {
  const inSlot = blocksForSlot(blocks, slot);
  if (!inSlot.length) return 10;
  if (afterId) {
    const index = inSlot.findIndex((block) => block.id === afterId);
    if (index >= 0) {
      const current = inSlot[index];
      const following = inSlot[index + 1];
      if (!following) return current.order + 10;
      return (current.order + following.order) / 2;
    }
  }
  return inSlot[inSlot.length - 1].order + 10;
}

export function reportBlockHasContent(html = "") {
  const raw = String(html);
  if (/<img\b/i.test(raw) || /<a\b/i.test(raw)) return true;
  return Boolean(plainText(raw));
}

export function googleWorkspaceKind(url = "") {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "docs.google.com" || host.endsWith(".docs.google.com")) return "docs";
    if (host === "drive.google.com" || host.endsWith(".drive.google.com")) return "drive";
    return "";
  } catch {
    return "";
  }
}

export function normalizeHttpUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw || /^mailto:/i.test(raw)) return raw;
  const withScheme = /^(https?:)\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.href;
  } catch {
    return "";
  }
}

export function defaultLinkLabel(url = "") {
  const kind = googleWorkspaceKind(url);
  if (kind === "docs") return "Google Doc";
  if (kind === "drive") return "Google Drive";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return String(url || "Link");
  }
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
