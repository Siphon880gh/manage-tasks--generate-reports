import test from "node:test";
import assert from "node:assert/strict";
import {
  accountRole, applyDropOrder, availableColumnTypes, availableColumnTypesForEdit, canAddColumnType, canAssignRole, canDeleteColumn, canEdit, canEditBoard,
  canManagePeople, canRemoveMember, columnTypeToStatus, confirmDeleteColumnMessage, confirmDeleteMessage, destinationAfterColumnDelete, filterByProjectIds, filterTasks,
  invitableUsers, isAdmin, isViewer, naturalJoin, reportRows, roleCaption, seedMemberships, statusToColumnType
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

test("editing a column can keep its unique type; last column cannot be deleted", () => {
  const columns = [
    { id: "t", type: "todo", name: "To do", order: 0 },
    { id: "p", type: "progress", name: "In progress", order: 1 },
    { id: "c", type: "complete", name: "Complete", order: 2 }
  ];
  assert.deepEqual(availableColumnTypesForEdit(columns, columns[2]).map((item) => item.id), ["todo", "progress", "complete"]);
  assert.equal(canDeleteColumn(columns), true);
  assert.equal(canDeleteColumn([columns[0]]), false);
  assert.equal(destinationAfterColumnDelete(columns, "p").id, "t");
  assert.match(confirmDeleteColumnMessage("Review", 2, "To do"), /2 tasks will move to To do/);
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

test("view-only users cannot edit; admin and missing role can", () => {
  assert.equal(isViewer({ role: "viewer" }), true);
  assert.equal(isAdmin({ role: "admin" }), true);
  assert.equal(canEdit({ role: "viewer" }), false);
  assert.equal(canEdit({ role: "editor" }), true);
  assert.equal(canEdit({ role: "admin" }), true);
  assert.equal(canEdit({}), true);
  assert.equal(canEdit(null), false);
  assert.equal(accountRole({ role: "admin" }), "admin");
  assert.equal(roleCaption({ role: "admin" }), "Admin");
  assert.equal(roleCaption({ role: "viewer" }), "View only");
  assert.equal(roleCaption({}), "Editor");
});

test("board invites grant access; last admin stays", () => {
  const users = [
    { id: "1", name: "Morgan Lee", role: "editor" },
    { id: "2", name: "Viewer User", role: "viewer" },
    { id: "3", name: "Admin User", role: "admin" }
  ];
  const seeded = seedMemberships([users[0]]);
  assert.equal(seeded[0].role, "admin");
  assert.deepEqual(invitableUsers(users, seeded).map((user) => user.id), ["2", "3"]);
  assert.equal(canEditBoard(users[0], seeded), true);
  assert.equal(canManagePeople(users[0], seeded), true);
  assert.equal(canEditBoard(users[1], seeded), false);
  const withViewer = [...seeded, { id: "m2", userId: "2", role: "viewer" }];
  assert.equal(canEditBoard(users[1], withViewer), false);
  assert.equal(canManagePeople(users[1], withViewer), false);
  assert.equal(canRemoveMember(users[0], seeded[0], withViewer), false);
  assert.equal(canRemoveMember(users[0], withViewer[1], withViewer), true);
  assert.equal(canAssignRole(users[0], seeded[0], "editor", withViewer), false);
  assert.equal(canAssignRole(users[0], withViewer[1], "editor", withViewer), true);
});

test("natural join names people for waiting copy", () => {
  assert.equal(naturalJoin([]), "a board admin");
  assert.equal(naturalJoin(["Morgan Lee"]), "Morgan Lee");
  assert.equal(naturalJoin(["Morgan Lee", "Admin User"]), "Morgan Lee or Admin User");
  assert.equal(naturalJoin(["A", "B", "C"]), "A, B, or C");
});
