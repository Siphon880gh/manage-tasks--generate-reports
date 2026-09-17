import test from "node:test";
import assert from "node:assert/strict";
import {
  applyDropOrder, availableColumnTypes, canAddColumnType, canEdit, columnTypeToStatus,
  confirmDeleteMessage, filterByProjectIds, filterTasks, isViewer, reportRows, statusToColumnType
} from "../app-core.mjs";

const tasks = [
  { id: "a", title: "Close books", project: "Finance", projectId: "p1", ownerName: "Ana", ownerId: "1", status: "done", rate: 1200, priority: "high", description: "<p>Q3 <strong>close</strong></p>" },
  { id: "b", title: "Build brief", project: "Atlas", projectId: "p2", ownerName: "Bo", ownerId: "2", status: "progress", rate: 0, priority: "medium", description: "plain" }
];

test("report rows honor an explicit project checkbox set", () => {
  assert.equal(reportRows(tasks, "stakeholder", { projectIds: ["p1"] }).length, 1);
  assert.equal(reportRows(tasks, "stakeholder", { projectIds: ["p1", "p2"] }).length, 2);
  assert.equal(reportRows(tasks, "stakeholder", { projectIds: [] }).length, 0);
});

test("invoice report still only includes complete work after project filter", () => {
  const rows = reportRows(tasks, "invoice", { projectIds: ["p1", "p2"] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Close books");
});

test("search strips rich text tags", () => {
  assert.equal(filterTasks(tasks, { query: "close" }).length, 1);
});

test("filterByProjectIds treats null as all and [] as none", () => {
  assert.equal(filterByProjectIds(tasks, null).length, 2);
  assert.equal(filterByProjectIds(tasks, []).length, 0);
});

test("complete column type is unique; others can repeat", () => {
  const columns = [{ type: "todo" }, { type: "progress" }, { type: "complete" }];
  assert.equal(canAddColumnType(columns, "complete"), false);
  assert.equal(canAddColumnType(columns, "todo"), true);
  assert.deepEqual(availableColumnTypes(columns).map((item) => item.id), ["todo", "progress"]);
});

test("status and column types stay aligned", () => {
  assert.equal(columnTypeToStatus("complete"), "done");
  assert.equal(statusToColumnType("progress"), "progress");
});

test("drop order inserts the moved card at the cued index", () => {
  const column = [{ id: "1", sortOrder: 10 }, { id: "2", sortOrder: 20 }, { id: "3", sortOrder: 30 }];
  const next = applyDropOrder(column, "3", 0);
  assert.deepEqual(next.map((task) => task.id), ["3", "1", "2"]);
  assert.deepEqual(next.map((task) => task.sortOrder), [10, 20, 30]);
});

test("delete confirmation names the count", () => {
  assert.match(confirmDeleteMessage(3, "in Atlas"), /Delete 3 tasks in Atlas/);
  assert.match(confirmDeleteMessage(1), /Delete 1 task\?/);
});

test("view-only users cannot edit; missing role is an editor", () => {
  assert.equal(isViewer({ role: "viewer" }), true);
  assert.equal(canEdit({ role: "viewer" }), false);
  assert.equal(canEdit({ role: "editor" }), true);
  assert.equal(canEdit({}), true);
  assert.equal(canEdit(null), false);
});
