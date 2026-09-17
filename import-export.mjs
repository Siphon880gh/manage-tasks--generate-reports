import { COLUMN_TYPES, plainText, sortTasks, statusToColumnType } from "./app-core.mjs";

export const CLICKUP_CSV_HEADERS = [
  "Task ID",
  "Task Name",
  "Task Content",
  "Status",
  "Priority",
  "List Name",
  "Folder Name",
  "Space Name",
  "Assignees",
  "Date created",
  "Date created Text",
  "Due date",
  "Due date Text"
];

const HEADER_ALIASES = {
  title: ["task name", "name", "title", "task"],
  description: ["task content", "task description", "description", "content", "details"],
  statusLabel: ["status", "status name", "column"],
  priority: ["priority"],
  project: ["list name", "list", "list clickup", "project", "project name"],
  folder: ["folder name", "folder name path", "folder"],
  space: ["space name", "space"],
  ownerName: ["assignees", "assignee", "owner", "owner name"],
  createdAt: ["date created", "date created text", "created", "created at", "created date"],
  completedAt: ["due date", "due date text", "date closed", "date done", "date completed", "completed", "completed at"],
  externalId: ["task id", "id", "custom task id", "task custom id"],
  rate: ["settlement", "rate", "amount", "settlement amount"]
};

export function normalizeHeader(name = "") {
  return String(name).replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[\s_/().-]+/g, " ").trim();
}

export function detectDelimiter(text) {
  const line = String(text).replace(/^\uFEFF/, "").split(/\r?\n/)[0] || "";
  const tabs = (line.match(/\t/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  return tabs > commas ? "\t" : ",";
}

export function parseCsv(text, delimiter = ",") {
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  const src = String(text ?? "").replace(/^\uFEFF/, "");
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === "\"") {
        if (src[i + 1] === "\"") { field += "\""; i += 2; continue; }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === "\"") { inQuotes = true; i += 1; continue; }
    if (ch === delimiter) { row.push(field); field = ""; i += 1; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
  }
  return rows;
}

export function toCsvValue(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll("\"", "\"\"")}"`;
  return text;
}

export function parseImportedDate(value) {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  if (/^\d{10}$/.test(raw)) return new Date(Number(raw) * 1000).toISOString();
  if (/^\d{13}$/.test(raw)) return new Date(Number(raw)).toISOString();
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseAssignees(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/^\[/, "").replace(/\]$/, "").split(",")[0].trim();
}

export function parseClickUpPriority(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["1", "2", "urgent", "high"].includes(raw)) return "high";
  if (["4", "low"].includes(raw)) return "low";
  return "medium";
}

export function toClickUpPriority(priority) {
  if (priority === "high") return "2";
  if (priority === "low") return "4";
  return "3";
}

export function mapClickUpStatus(statusLabel) {
  const value = String(statusLabel || "").trim().toLowerCase();
  if (!value) return "backlog";
  if (/^(complete|completed|done|closed|delivered|finished)$/.test(value)) return "done";
  if (/^(in progress|in-progress|progress|doing|active|working|in flight)$/.test(value)) return "progress";
  if (/^(to do|todo|to-do|open|backlog|planned|not started|idea)$/.test(value)) return "backlog";
  if (/review|blocked|waiting|qa|hold|pending/.test(value)) return "progress";
  return "backlog";
}

export function clickUpStatusLabel(status, columnName) {
  if (columnName) return columnName;
  if (status === "done") return "complete";
  if (status === "progress") return "in progress";
  return "to do";
}

export function detectImportFormat(text, filename = "") {
  const name = String(filename).toLowerCase();
  const trimmed = String(text || "").trim();
  if (!trimmed) return "unknown";
  if (name.endsWith(".json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const data = JSON.parse(trimmed);
      if (data && data.format === "ledgerlane") return "ledgerlane";
      return "clickup-json";
    } catch {
      return "unknown";
    }
  }
  const rows = parseCsv(trimmed, detectDelimiter(trimmed));
  const headers = (rows[0] || []).map(normalizeHeader);
  if (headers.includes("task name") || headers.includes("task content") || headers.includes("list name") || headers.includes("space name")) return "clickup-csv";
  if (headers.includes("title")) return "ledgerlane-csv";
  return headers.length > 1 ? "clickup-csv" : "unknown";
}

function headerIndex(headers) {
  const map = {};
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(normalized) && map[key] == null) map[key] = index;
    }
  });
  return map;
}

function cell(row, index) {
  return index == null ? "" : String(row[index] ?? "").trim();
}

function draftFromRow(row, indexMap) {
  const title = cell(row, indexMap.title);
  if (!title) return null;
  const statusLabel = cell(row, indexMap.statusLabel);
  const project = cell(row, indexMap.project) || cell(row, indexMap.folder) || cell(row, indexMap.space) || "Imported";
  return {
    title,
    description: cell(row, indexMap.description),
    statusLabel,
    status: mapClickUpStatus(statusLabel),
    priority: parseClickUpPriority(cell(row, indexMap.priority)),
    project,
    ownerName: parseAssignees(cell(row, indexMap.ownerName)),
    createdAt: parseImportedDate(cell(row, indexMap.createdAt)),
    completedAt: parseImportedDate(cell(row, indexMap.completedAt)),
    rate: Number(cell(row, indexMap.rate)) || 0,
    externalId: cell(row, indexMap.externalId)
  };
}

function draftsFromObjects(rows) {
  return rows.map((item) => {
    if (!item || typeof item !== "object") return null;
    if (item.title && item.project) {
      return {
        title: item.title,
        description: item.description || "",
        statusLabel: item.statusLabel || item.status || "",
        status: item.status && ["backlog", "progress", "done"].includes(item.status) ? item.status : mapClickUpStatus(item.status || item.statusLabel),
        priority: parseClickUpPriority(item.priority),
        project: item.project || item.listName || item.space || "Imported",
        ownerName: parseAssignees(item.ownerName || item.assignees || ""),
        createdAt: parseImportedDate(item.createdAt),
        completedAt: parseImportedDate(item.completedAt),
        rate: Number(item.rate) || 0,
        externalId: item.externalId || item.id || "",
        columnName: item.columnName || ""
      };
    }
    const keys = Object.keys(item);
    const row = keys.map((key) => item[key]);
    return draftFromRow(row, headerIndex(keys));
  }).filter(Boolean);
}

export function parseImport(text, filename = "") {
  const format = detectImportFormat(text, filename);
  if (format === "unknown") return { format, tasks: [], projects: [], label: "Unknown file" };
  const trimmed = String(text || "").trim();
  if (format === "ledgerlane") {
    const data = JSON.parse(trimmed);
    const tasks = (data.tasks || []).map((task) => ({
      title: task.title,
      description: task.description || "",
      status: task.status || mapClickUpStatus(task.statusLabel),
      statusLabel: task.statusLabel || "",
      priority: parseClickUpPriority(task.priority),
      project: task.project || "Imported",
      ownerName: task.ownerName || "",
      createdAt: task.createdAt || null,
      completedAt: task.completedAt || null,
      rate: Number(task.rate) || 0,
      externalId: task.externalId || task.id || "",
      columnName: task.columnName || "",
      columnType: task.columnType || statusToColumnType(task.status)
    })).filter((task) => task.title);
    const projects = data.projects || [...new Set(tasks.map((task) => task.project))].map((name) => ({ name }));
    const columns = data.columns || [];
    return { format, tasks, projects, columns, label: "LedgerLane backup" };
  }
  if (format === "clickup-json") {
    const data = JSON.parse(trimmed);
    const rows = Array.isArray(data) ? data : data.tasks || data.items || [];
    const tasks = draftsFromObjects(rows);
    return summarizeDrafts(format, tasks, "ClickUp JSON");
  }
  const table = parseCsv(trimmed, detectDelimiter(trimmed));
  const [headers = [], ...body] = table;
  const indexMap = headerIndex(headers);
  const tasks = body.map((row) => draftFromRow(row, indexMap)).filter(Boolean);
  const label = format === "ledgerlane-csv" ? "LedgerLane CSV" : "ClickUp CSV";
  return summarizeDrafts(format, tasks, label);
}

function summarizeDrafts(format, tasks, label) {
  const projects = [...new Set(tasks.map((task) => task.project).filter(Boolean))].map((name) => ({ name }));
  return { format, tasks, projects, columns: [], label };
}

export function importPreview(parsed, existingCount, mode) {
  const incoming = parsed.tasks.length;
  const next = mode === "replace" ? incoming : existingCount + incoming;
  return {
    formatLabel: parsed.label,
    incoming,
    projects: parsed.projects.length,
    existingCount,
    nextCount: next,
    mode
  };
}

export function buildLedgerLaneBackup({ projects, columns, tasks }) {
  return {
    format: "ledgerlane",
    version: 1,
    exportedAt: new Date().toISOString(),
    projects: projects.map((project) => ({ id: project.id, name: project.name })),
    columns: columns.map((column) => ({
      id: column.id, projectId: column.projectId, name: column.name, type: column.type, order: column.order
    })),
    tasks: tasks.map((task) => ({
      title: task.title,
      project: task.project,
      projectId: task.projectId,
      columnId: task.columnId,
      columnName: columns.find((column) => column.id === task.columnId)?.name || "",
      columnType: statusToColumnType(task.status),
      status: task.status,
      priority: task.priority,
      ownerName: task.ownerName,
      description: task.description || "",
      rate: task.rate || 0,
      createdAt: task.createdAt,
      completedAt: task.completedAt,
      timestampOverridden: Boolean(task.timestampOverridden),
      sortOrder: task.sortOrder ?? 0,
      externalId: task.externalId || ""
    }))
  };
}

export function buildClickUpCsv(tasks, { columns = [] } = {}) {
  const lines = [CLICKUP_CSV_HEADERS.map(toCsvValue).join(",")];
  for (const task of tasks) {
    const column = columns.find((item) => item.id === task.columnId);
    const created = task.createdAt ? new Date(task.createdAt) : null;
    const completed = task.completedAt ? new Date(task.completedAt) : null;
    const status = clickUpStatusLabel(task.status, column?.name);
    const row = [
      task.externalId || task.id || "",
      task.title || "",
      plainText(task.description),
      status,
      toClickUpPriority(task.priority),
      task.project || "",
      "",
      "LedgerLane",
      task.ownerName ? `[${task.ownerName}]` : "",
      created && !Number.isNaN(created.getTime()) ? String(created.getTime()) : "",
      created && !Number.isNaN(created.getTime()) ? created.toISOString() : "",
      completed && !Number.isNaN(completed.getTime()) ? String(completed.getTime()) : "",
      completed && !Number.isNaN(completed.getTime()) ? completed.toISOString() : ""
    ];
    lines.push(row.map(toCsvValue).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function columnTypeForImport(draft) {
  if (draft.columnType) return draft.columnType;
  return statusToColumnType(draft.status || mapClickUpStatus(draft.statusLabel));
}

function notionColumnLabel(task, columns = []) {
  const named = columns.find((item) => item.id === task.columnId);
  if (named?.name) return named.name;
  return COLUMN_TYPES.find((item) => item.status === task.status)?.label || "To do";
}

function notionEscape(value = "") {
  return String(value).replace(/([\\`*_[\]#])/g, "\\$1");
}

export function buildNotionMarkdown(tasks = [], { projects = [], columns = [] } = {}) {
  if (!tasks.length) return "# LedgerLane\n\nNo tasks to copy.\n";
  const groups = new Map();
  for (const task of tasks) {
    const project = task.project || projects.find((item) => item.id === task.projectId)?.name || "Untitled";
    if (!groups.has(project)) groups.set(project, []);
    groups.get(project).push(task);
  }
  const lines = ["# LedgerLane", ""];
  for (const project of [...groups.keys()].sort((a, b) => a.localeCompare(b))) {
    const projectTasks = groups.get(project);
    lines.push(`## ${notionEscape(project)}`, "");
    const byColumn = new Map();
    for (const task of projectTasks) {
      const label = notionColumnLabel(task, columns);
      if (!byColumn.has(label)) byColumn.set(label, []);
      byColumn.get(label).push(task);
    }
    const projectId = projectTasks.find((task) => task.projectId)?.projectId;
    const ordered = columns.filter((column) => column.projectId === projectId).sort((a, b) => a.order - b.order);
    const labels = ordered.length
      ? [...new Set([...ordered.map((column) => column.name), ...byColumn.keys()])]
      : COLUMN_TYPES.map((type) => type.label).filter((label) => byColumn.has(label));
    for (const extra of byColumn.keys()) {
      if (!labels.includes(extra)) labels.push(extra);
    }
    for (const label of labels) {
      const items = sortTasks(byColumn.get(label) || []);
      if (!items.length) continue;
      lines.push(`### ${notionEscape(label)}`, "");
      for (const task of items) {
        lines.push(`- [${task.status === "done" ? "x" : " "}] **${notionEscape(task.title || "Untitled")}**`);
        const meta = [task.priority ? `${task.priority} priority` : "", task.ownerName || ""].filter(Boolean).join(" · ");
        if (meta) lines.push(`  ${meta}`);
        const body = plainText(task.description);
        if (body) lines.push(`  ${body}`);
      }
      lines.push("");
    }
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}
