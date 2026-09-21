import test from "node:test";
import assert from "node:assert/strict";
import {
  buildClickUpCsv, buildLedgerLaneBackup, buildNotionMarkdown, detectImportFormat, importPreview, mapClickUpStatus, parseAssignees,
  parseClickUpPriority, parseCsv, parseImport, parseImportedDate, toClickUpPriority
} from "../import-export.mjs";

const clickupCsv = [
  "Task ID,Task Name,Task Content,Status,Priority,List Name,Space Name,Assignees,Date created",
  "abc,\"Design landing, v2\",\"Hero and CTA\",in progress,2,Website,Client work,\"[Ada Lovelace,Grace]\",1700000000000",
  "def,Close books,Q4 settlement,complete,3,Website,Client work,Ada Lovelace,1700000000000"
].join("\n");

test("parses quoted CSV fields that contain commas", () => {
  const rows = parseCsv("Task Name,Note\n\"Hello, world\",ok");
  assert.equal(rows[1][0], "Hello, world");
});

test("detects ClickUp CSV from official headers", () => {
  assert.equal(detectImportFormat(clickupCsv, "export.csv"), "clickup-csv");
  assert.equal(detectImportFormat(JSON.stringify({ format: "ledgerlane", tasks: [] }), "backup.json"), "ledgerlane");
});

test("imports ClickUp export rows into drafts", () => {
  const parsed = parseImport(clickupCsv, "clickup.csv");
  assert.equal(parsed.label, "ClickUp CSV");
  assert.equal(parsed.tasks.length, 2);
  assert.equal(parsed.tasks[0].title, "Design landing, v2");
  assert.equal(parsed.tasks[0].status, "progress");
  assert.equal(parsed.tasks[0].priority, "high");
  assert.equal(parsed.tasks[0].project, "Website");
  assert.equal(parsed.tasks[0].ownerName, "Ada Lovelace");
  assert.equal(parsed.tasks[1].status, "done");
});

test("maps ClickUp statuses and numeric priorities", () => {
  assert.equal(mapClickUpStatus("Open"), "backlog");
  assert.equal(mapClickUpStatus("review"), "progress");
  assert.equal(mapClickUpStatus("closed"), "done");
  assert.equal(parseClickUpPriority("1"), "high");
  assert.equal(toClickUpPriority("low"), "4");
});

test("parses assignee lists and unix dates", () => {
  assert.equal(parseAssignees("[John Smith,Mary Smith]"), "John Smith");
  assert.equal(parseImportedDate("1700000000000"), new Date(1700000000000).toISOString());
});

test("append vs replace preview counts", () => {
  const parsed = parseImport(clickupCsv, "clickup.csv");
  assert.equal(importPreview(parsed, 6, "append").nextCount, 8);
  assert.equal(importPreview(parsed, 6, "replace").nextCount, 2);
});

test("ClickUp CSV export round-trips through the importer", () => {
  const csv = buildClickUpCsv([
    { id: "1", title: "Ship it", description: "Done", status: "done", priority: "medium", project: "Atlas", ownerName: "Morgan Lee", createdAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-02T00:00:00.000Z" }
  ]);
  assert.match(csv, /Task Name,Task Content,Status,Priority,List Name/);
  const parsed = parseImport(csv, "clickup-tasks.csv");
  assert.equal(parsed.tasks[0].title, "Ship it");
  assert.equal(parsed.tasks[0].project, "Atlas");
  assert.equal(parsed.tasks[0].status, "done");
});

test("Notion export is Markdown to-dos grouped by project and column", () => {
  const markdown = buildNotionMarkdown([
    { title: "Ship it", project: "Atlas", status: "done", priority: "medium", ownerName: "Morgan Lee", description: "<p>Done <strong>today</strong></p>", sortOrder: 20 },
    { title: "Write brief", project: "Atlas", status: "backlog", priority: "high", ownerName: "Morgan Lee", description: "Outline", sortOrder: 10 },
    { title: "Invoice Q3", project: "Finance", status: "progress", priority: "low", ownerName: "Ada", sortOrder: 5 }
  ]);
  assert.match(markdown, /^# LedgerLane/m);
  assert.match(markdown, /## Atlas/);
  assert.match(markdown, /### To do/);
  assert.match(markdown, /- \[ \] \*\*Write brief\*\*/);
  assert.match(markdown, /- \[x\] \*\*Ship it\*\*/);
  assert.match(markdown, /Done today/);
  assert.match(markdown, /## Finance/);
  assert.match(markdown, /### In progress/);
  assert.equal(buildNotionMarkdown([]), "# LedgerLane\n\nNo tasks to copy.\n");
});

test("LedgerLane backup preserves follow-on engagement lists and links", () => {
  const backup = buildLedgerLaneBackup({
    projects: [{ id: "p1", name: "Autumn programme support" }], columns: [], tasks: [], tags: [],
    engagements: [{ id: "e1", name: "Autumn programme support", terms: "barter", exchangeNote: "Office hours for facilitation", priorProjectId: "p0", projectId: "p1", createdAt: "2026-09-20T00:00:00.000Z" }],
    engagementTasks: [{ id: "et1", engagementId: "e1", title: "Run workshop", notes: "Bring materials", timing: "ongoing", status: "backlog", sortOrder: 1 }]
  });
  const parsed = parseImport(JSON.stringify(backup), "ledgerlane-backup.json");
  assert.equal(backup.version, 2);
  assert.equal(parsed.engagements[0].terms, "barter");
  assert.equal(parsed.engagements[0].projectId, "p1");
  assert.equal(parsed.engagementTasks[0].sourceEngagementId, "e1");
  assert.equal(parsed.engagementTasks[0].timing, "ongoing");
});
