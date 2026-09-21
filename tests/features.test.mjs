import test from "node:test";
import assert from "node:assert/strict";
import {
  accountRole, applyDropOrder, availableColumnTypes, availableColumnTypesForEdit, canAddColumnType, canAssignRole, canDeleteColumn, canEdit, canEditBoard,
  canManagePeople, canRemoveMember, columnTypeToStatus, confirmDeleteColumnMessage, confirmDeleteMessage, destinationAfterColumnDelete, filterByProjectIds, filterTasks,
  invitableUsers, isAdmin, isViewer, naturalJoin, nextReportBlockOrder, normalizeHttpUrl, normalizeReportBlocks,
  reportBlockHasContent, reportRows, roleCaption, seedMemberships, statusToColumnType, blocksForSlot, defaultLinkLabel,
  googleWorkspaceKind, reindexReportBlocks, emptyBoardFilters, boardFiltersActive, normalizeTagName, toggleListValue,
  ENGAGEMENT_TERMS, engagementCashAmount, engagementIsCashSettlement, engagementTermsLabel, engagementWorkTimingLabel, normalizeEngagementTerms
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

test("follow-on engagements keep four explicit terms and non-cash defaults", () => {
  assert.deepEqual(ENGAGEMENT_TERMS.map((term) => term.id), ["one-time", "retainer", "barter", "community-partnership"]);
  assert.equal(normalizeEngagementTerms("BARTER"), "barter");
  assert.equal(normalizeEngagementTerms("proposal"), "");
  assert.equal(engagementTermsLabel("community-partnership"), "Community partnership");
  assert.equal(engagementCashAmount({ terms: "barter" }), 0);
  assert.equal(engagementIsCashSettlement({ terms: "barter" }), false);
  assert.equal(engagementIsCashSettlement({ terms: "barter", amount: 500 }), true);
  assert.equal(engagementWorkTimingLabel({ timing: "ongoing" }), "Ongoing");
  assert.equal(engagementWorkTimingLabel({ timing: "undated" }), "Undated");
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

test("report notes stack between sections and keep insert order", () => {
  const first = { id: "a", slot: "after-head", html: "<p>Hi</p>", order: nextReportBlockOrder([], "after-head") };
  const stacked = normalizeReportBlocks([first]);
  const second = { id: "b", slot: "after-head", html: "<p>There</p>", order: nextReportBlockOrder(stacked, "after-head", "a") };
  const both = reindexReportBlocks([...stacked, second]);
  assert.deepEqual(blocksForSlot(both, "after-head").map((block) => block.id), ["a", "b"]);
  const between = { id: "c", slot: "after-head", html: "<p>Mid</p>", order: nextReportBlockOrder(both, "after-head", "a") };
  assert.deepEqual(blocksForSlot(reindexReportBlocks([...both, between]), "after-head").map((block) => block.id), ["a", "c", "b"]);
});

test("empty report html is ignored unless it has media or a link", () => {
  assert.equal(reportBlockHasContent("<p><br></p>"), false);
  assert.equal(reportBlockHasContent('<p><img src="data:image/png;base64,xx" alt=""></p>'), true);
  assert.equal(reportBlockHasContent('<p><a href="https://docs.google.com/document/d/x">Doc</a></p>'), true);
});

test("google Drive and Docs urls get a clear label", () => {
  assert.equal(googleWorkspaceKind("https://docs.google.com/document/d/abc"), "docs");
  assert.equal(googleWorkspaceKind("https://drive.google.com/file/d/abc/view"), "drive");
  assert.equal(googleWorkspaceKind("https://example.com/file"), "");
  assert.equal(defaultLinkLabel("https://docs.google.com/document/d/abc"), "Google Doc");
  assert.equal(defaultLinkLabel("https://drive.google.com/file/d/abc/view"), "Google Drive");
  assert.match(normalizeHttpUrl("docs.google.com/document/d/abc"), /^https:\/\/docs\.google\.com\/document\/d\/abc\/?$/);
});

const tagged = [
  { id: "1", title: "A", tagIds: ["t1"], color: "coral" },
  { id: "2", title: "B", tagIds: ["t2"], color: "blue" },
  { id: "3", title: "C", tagIds: ["t1", "t2"], color: "coral" },
  { id: "4", title: "D", tagIds: [], color: "none" }
];

test("tag filters match any selected tag", () => {
  assert.deepEqual(filterTasks(tagged, { tags: ["t1"] }).map((task) => task.id), ["1", "3"]);
  assert.deepEqual(filterTasks(tagged, { tags: ["t1", "t2"] }).map((task) => task.id), ["1", "2", "3"]);
});

test("color filters match selected card colors", () => {
  assert.deepEqual(filterTasks(tagged, { colors: ["coral"] }).map((task) => task.id), ["1", "3"]);
  assert.deepEqual(filterTasks(tagged, { colors: ["none"] }).map((task) => task.id), ["4"]);
  assert.deepEqual(filterTasks(tagged, { colors: ["coral", "blue"] }).map((task) => task.id), ["1", "2", "3"]);
});

test("combined tag and color filters require both", () => {
  assert.deepEqual(filterTasks(tagged, { tags: ["t1"], colors: ["coral"] }).map((task) => task.id), ["1", "3"]);
  assert.deepEqual(filterTasks(tagged, { tags: ["t2"], colors: ["coral"] }).map((task) => task.id), ["3"]);
  assert.equal(filterTasks(tagged, { tags: ["t2"], colors: ["sage"] }).length, 0);
});

test("clearing board filters resets every facet", () => {
  assert.equal(boardFiltersActive({ query: "x", owner: "all", project: "all", tags: [], colors: [] }), true);
  assert.equal(boardFiltersActive({ query: "", owner: "all", project: "all", tags: ["t1"], colors: [] }), true);
  assert.equal(boardFiltersActive({ query: "", owner: "all", project: "all", tags: [], colors: ["coral"] }), true);
  assert.equal(boardFiltersActive(emptyBoardFilters()), false);
  assert.equal(normalizeTagName("  Billing  "), "Billing");
  assert.deepEqual(toggleListValue(["t1"], "t2"), ["t1", "t2"]);
  assert.deepEqual(toggleListValue(["t1", "t2"], "t1"), ["t2"]);
});
