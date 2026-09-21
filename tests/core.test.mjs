import test from "node:test";
import assert from "node:assert/strict";
import { filterTasks, reportRows, taskProgress, toCsv } from "../app-core.mjs";

const tasks = [
  { title: "Close books", project: "Finance", ownerName: "Ana", ownerId: "1", status: "done", rate: 1200, priority: "high" },
  { title: "Build brief", project: "Atlas", ownerName: "Bo", ownerId: "2", status: "progress", rate: 0, priority: "medium" }
];

test("filters across searchable fields and exact facets", () => {
  assert.equal(filterTasks(tasks, { query: "finance" }).length, 1);
  assert.equal(filterTasks(tasks, { owner: "2", project: "Atlas" })[0].title, "Build brief");
});
test("invoice report includes work in every status unless excluded", () => {
  const rows = reportRows(tasks, "invoice");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].result, "$1,200");
  assert.equal(reportRows([...tasks, { ...tasks[0], invoiceIncluded: false }], "invoice").length, 2);
});
test("stakeholder report translates status into outcomes", () => assert.equal(reportRows(tasks, "stakeholder")[1].result, "In flight"));
test("progress is calculated safely", () => { assert.equal(taskProgress(tasks), 50); assert.equal(taskProgress([]), 0); });
test("CSV output escapes values", () => assert.match(toCsv([{ name: 'A "quoted" task' }], [{ label: "Name", value: (r) => r.name }]), /"A ""quoted"" task"/));
