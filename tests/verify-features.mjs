import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const PORT = 4175;
const server = spawn("python3", ["-m", "http.server", String(PORT)], { stdio: "ignore" });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
await mkdir("artifacts", { recursive: true });

async function openBoardMenu(page) {
  const panel = page.locator("#board-menu-panel");
  if (await panel.isHidden()) await page.locator("#board-menu-toggle").click();
  await panel.waitFor({ state: "visible" });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}`)).ok) return; } catch { /* still starting */ }
    await wait(150);
  }
  throw new Error("Static server did not become ready");
}

function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  const mark = passed ? "PASS" : "FAIL";
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!passed) throw new Error(`Verification failed: ${name}${detail ? ` (${detail})` : ""}`);
}

async function signOut(page) {
  await page.locator("#account-button").click();
  await page.locator("#sign-out-button").click();
  await page.waitForSelector("#confirm-dialog[open]");
  await page.locator("#confirm-ok").click();
  await page.waitForSelector("#auth-form");
}

async function signIn(page, username, password) {
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Passphrase").fill(password);
  await page.getByRole("button", { name: /Enter workspace/ }).click();
}

async function inviteToBoard(page, name, role) {
  await page.locator("#open-people").click();
  await page.waitForSelector("#people-dialog[open]");
  const invite = page.locator("#invite-people");
  if (await invite.evaluate((el) => !el.open)) await page.locator("#invite-people summary").click();
  await page.locator("#invite-user").selectOption({ label: name });
  await page.locator("#invite-role").selectOption(role);
  await page.locator("#confirm-invite-person").click();
  await page.waitForFunction((who) => document.querySelector("#people-list")?.innerText.includes(who), name);
  await page.locator("#done-people").click();
  await page.locator("#people-dialog").waitFor({ state: "hidden" });
}

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const editorUsername = `morgan-${Date.now()}`;
  const viewerUsername = `viewer-${Date.now()}`;
  const adminUsername = `admin-${Date.now()}`;
  await page.goto(`http://127.0.0.1:${PORT}`);
  check("account type starts closed", await page.locator("#account-type-options").evaluate((el) => !el.open));
  await page.getByLabel("Display name").fill("Morgan Lee");
  await page.getByLabel("Username").fill(editorUsername);
  await page.getByLabel("Passphrase").fill("local-demo-passphrase");
  await page.getByRole("button", { name: /Create local account/ }).click();
  await page.waitForSelector(".task-card");
  check("seeded board", await page.locator(".task-card").count() === 6, "expected 6 cards");
  check("board title is compact", (await page.locator(".page-title").innerText()).trim() === "Delivery");
  check("account is a menu", await page.locator("#account-button").getAttribute("aria-label") === "Account menu");
  check("people trigger", await page.locator("#open-people").isVisible());
  await page.locator("#open-people").click();
  await page.waitForSelector("#people-dialog[open]");
  check("people list shows owner", (await page.locator("#people-list").innerText()).includes("Morgan Lee"));
  check("invite hidden when alone", await page.locator("#invite-people").isHidden());
  await page.locator("#done-people").click();
  await page.locator("#people-dialog").waitFor({ state: "hidden" });

  const checkboxes = page.locator(".task-card [data-select]");
  check("multi-select checkboxes", await checkboxes.count() === 6);
  await page.evaluate(() => {
    document.querySelectorAll(".task-card [data-select]").forEach((box, index) => {
      if (index > 1) return;
      box.checked = true;
      box.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });
  const selectedLabel = (await page.locator("#selection-count").innerText()).trim();
  check("selection count", /2 selected/i.test(selectedLabel), selectedLabel);
  await page.locator("#delete-selected").click();
  await page.waitForSelector("#confirm-dialog[open]");
  check("delete-selected confirm", await page.locator("#confirm-message").innerText() === "Delete 2 tasks from the selection? This cannot be undone.");
  await page.locator("#confirm-cancel").click();
  check("delete-selected cancel keeps tasks", await page.locator(".task-card").count() === 6);

  await openBoardMenu(page);
  check("delete-all control", await page.locator("#delete-all-tasks").isVisible());
  await page.locator("#delete-all-tasks").click();
  await page.waitForSelector("#confirm-dialog[open]");
  check("delete-all confirm copy", (await page.locator("#confirm-message").innerText()).includes("Delete 6 tasks"));
  await page.locator("#confirm-cancel").click();
  check("delete-all cancel keeps tasks", await page.locator(".task-card").count() === 6);

  check("new project stays off the daily board", await page.locator("#new-project").count() === 0);
  check("add column stays off the daily board", await page.locator("#add-column-toggle").count() === 0);
  check("edit board control", await page.locator("#edit-board").isVisible());
  await page.locator("#edit-board").click();
  await page.waitForSelector("#structure-bar");
  check("structure mode on", await page.locator("#structure-bar").isVisible());
  check("structure picks a project so columns can be edited", await page.locator("[data-edit-column]").count() >= 3);
  check("new project in structure mode", await page.locator("#new-project").isVisible());
  await page.locator("#new-project").click();
  await page.locator("#project-name").fill("Northstar");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForFunction(() => document.querySelector("#project-filter option:checked")?.textContent?.trim() === "Northstar");
  check("new project selected", (await page.locator("#project-filter option:checked").textContent()).trim() === "Northstar");
  check("default columns on new project", await page.locator(".column").count() === 3);
  check("add column control", await page.locator("#add-column-toggle").isVisible());
  await page.locator("#add-column-toggle").click();
  await page.waitForSelector("#column-dialog[open]");
  check("add column is a modal", await page.locator("#column-dialog").evaluate((dialog) => dialog.open));
  check("column type starts collapsed", await page.locator("#column-type-options").evaluate((el) => !el.open));
  const typeLabels = await page.locator("#column-type option").allTextContents();
  check("complete type omitted when one exists", typeLabels.every((label) => !label.toLowerCase().startsWith("complete")));
  await page.locator("#column-name").fill("Review");
  await page.locator("#column-form").getByRole("button", { name: "Add column" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".column").length === 4);
  check("custom column added", await page.locator(".column").count() === 4);
  check("column pencils in structure mode", await page.locator(".column-edit").count() === 4);
  await page.locator(".column-edit").first().click();
  await page.waitForSelector("#column-dialog[open]");
  check("edit column is a modal", (await page.locator("#column-dialog-title").innerText()).trim() === "Edit column");
  check("edit column shows type", await page.locator("#column-type-options").evaluate((el) => el.open));
  await page.locator("#column-name").fill("Ready queue");
  await page.locator("#column-form").getByRole("button", { name: "Save column" }).click();
  await page.waitForFunction(() => [...document.querySelectorAll(".column h2")].some((el) => (el.textContent || "").trim() === "Ready queue"));
  check("column renamed", true);
  await page.locator(".column-edit").last().click();
  await page.waitForSelector("#column-dialog[open]");
  check("delete column control", await page.locator("#delete-column").isVisible());
  await page.locator("#delete-column").click();
  await page.waitForSelector("#confirm-dialog[open]");
  check("delete column confirms", (await page.locator("#confirm-message").innerText()).includes("Delete column Review"));
  await page.locator("#confirm-ok").click();
  await page.waitForFunction(() => document.querySelectorAll(".column").length === 3);
  check("column deleted", await page.locator(".column").count() === 3);

  await page.locator("#project-filter").selectOption("all");
  await page.waitForSelector(".task-card");
  check("tag filter chips", await page.locator("#tag-filters [data-filter-tag]").count() >= 2);
  check("color filter chips", await page.locator("#color-filters [data-filter-color]").count() === 6);
  const billingChip = page.locator("#tag-filters [data-filter-tag]").filter({ hasText: /^billing$/i });
  const opsChip = page.locator("#tag-filters [data-filter-tag]").filter({ hasText: /^ops$/i });
  await billingChip.click();
  check("tag filter matches any selected tag", await page.locator(".task-card").count() === 3);
  await opsChip.click();
  check("multiple tags are OR", await page.locator(".task-card").count() === 5);
  await page.locator('[data-filter-color="coral"]').click();
  check("combined tag and color filters AND", await page.locator(".task-card").count() === 2);
  await page.locator("#clear-filters").click();
  check("clear filters shows every card", await page.locator(".task-card").count() === 6);
  await page.locator('[data-filter-color="coral"]').click();
  check("color filter alone", await page.locator(".task-card").count() === 2);
  await page.locator("#clear-filters").click();
  check("clear color filter", await page.locator(".task-card").count() === 6);
  check("editor has card color swatches", await page.locator(".card-swatch-toggle").count() === 6);
  check("editor has card tag add", await page.locator(".card-tag-add").count() === 6);
  const notesCard = page.locator(".task-card").filter({ hasText: "Publish migration notes" });
  await notesCard.locator(".card-swatch-toggle").click();
  check("card color picker opens", await notesCard.locator(".card-color-option").count() === 6);
  await notesCard.locator('[data-set-card-color="acid"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll(".task-card")].some((card) => card.dataset.color === "acid" && (card.innerText || "").includes("Publish migration notes")));
  check("card color from card", await notesCard.getAttribute("data-color") === "acid");
  await notesCard.locator(".card-tag-add").click();
  await notesCard.locator(".card-new-tag").fill("launch");
  await notesCard.locator("[data-add-card-tag]").click();
  await page.waitForFunction(() => [...document.querySelectorAll(".card-tag")].some((el) => (el.textContent || "").trim().toLowerCase() === "launch"));
  check("create tag from card", await notesCard.locator(".card-tag").filter({ hasText: /^launch$/i }).count() === 1);

  await page.locator(".task-card").first().click();
  await page.waitForSelector("#task-dialog[open]");
  check("clickup title field", await page.locator(".title-field input").isVisible());
  check("rtf editor", await page.locator("#task-description").isVisible());
  check("rtf toolbar", await page.locator(".rtf-toolbar [data-cmd]").count() >= 5);
  check("task details collapsed", await page.locator("#task-details").evaluate((el) => !el.open));
  check("advanced collapsed", await page.locator("#advanced-options").getAttribute("open") === null);
  await page.locator("#task-details summary").click();
  check("tag picker", await page.locator("#task-tag-list").isVisible());
  await page.locator("#task-new-tag").fill("urgent");
  await page.locator("#add-task-tag").click();
  await page.waitForFunction(() => (document.querySelector("#task-tag-list")?.innerText || "").toLowerCase().includes("urgent"));
  check("create tag from task", (await page.locator("#task-tag-list").innerText()).toLowerCase().includes("urgent"));
  await page.locator('#task-color-list input[value="gold"]').check();
  check("assign card color", await page.locator('#task-color-list input[value="gold"]').isChecked());
  await page.locator("#attach-menu-toggle").click();
  check("file attach control", await page.locator("#attach-files").count() === 1);
  check("task record control", await page.locator("#record-screen").isVisible());
  await page.locator("#task-description").click();
  await page.keyboard.type("Verified rich notes");
  await page.locator("#task-form").getByRole("button", { name: "Save task" }).click();
  await page.locator("#task-dialog").waitFor({ state: "hidden" });
  check("task dialog closed after save", true);
  check("card shows created tag", await page.locator(".card-tag").filter({ hasText: /^urgent$/i }).count() === 1);
  check("card color persisted", await page.locator('.task-card[data-color="gold"]').count() >= 2);
  await page.locator("#tag-filters [data-filter-tag]").filter({ hasText: /^urgent$/i }).click();
  check("filter by created tag", await page.locator(".task-card").count() === 1);
  await page.locator("#clear-filters").click();
  check("clear after created tag", await page.locator(".task-card").count() === 6);

  await openBoardMenu(page);
  check("board record control", (await page.locator("#record-board").innerText()).includes("Record screen"));
  await page.locator("#board-menu-toggle").click();
  check("record hud markup", await page.locator("#record-hud.record-bar").count() === 1);
  check("record stop control", await page.locator("#stop-recording").count() === 1);
  check("record discard control", await page.locator("#cancel-recording").count() === 1);
  check("drop targets", await page.locator("[data-drop]").count() === 3);
  const dropCue = await page.evaluate(() => {
    const column = document.querySelector("[data-drop]");
    const card = document.querySelector(".task-card");
    if (!column || !card) return false;
    const enter = new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() });
    card.dispatchEvent(enter);
    const over = new DragEvent("dragover", { bubbles: true, cancelable: true, clientY: column.getBoundingClientRect().top + 120, dataTransfer: new DataTransfer() });
    column.dispatchEvent(over);
    const seen = Boolean(column.classList.contains("is-drop-target") && column.querySelector(".drop-slot"));
    card.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
    return seen;
  });
  check("drag drop visual cue", dropCue);

  await page.getByRole("button", { name: "Reports" }).first().click();
  await page.waitForSelector("#report-projects");
  check("report title is compact", (await page.locator(".page-title").innerText()).trim() === "Proof");
  check("report refine follows viewport", await page.locator("#report-refine").evaluate((el) => el.open === window.matchMedia("(min-width: 801px)").matches));
  check("report projects stay usable on desktop", await page.locator("#report-no-projects").isVisible());
  const projectBoxes = page.locator("[data-report-project]");
  check("report project checkboxes", await projectBoxes.count() >= 4);
  const firstId = await projectBoxes.first().getAttribute("data-report-project");
  await page.locator("#report-no-projects").click();
  check("report none is empty", await page.locator(".report-sheet .empty").count() === 1);
  await page.locator(`[data-report-project="${firstId}"]`).check();
  check("report single project has rows or empty from that project", await page.locator(".report-sheet").count() === 1);
  await page.locator("#report-all-projects").click();
  await page.getByRole("button", { name: "Project manager" }).click();
  await page.waitForSelector("text=Delivery detail");
  check("report lens still works with project filters", true);
  await page.getByRole("button", { name: "Invoice settlement" }).click();
  await page.waitForSelector("text=prepared for settlement");

  check("editor can edit report", await page.locator("#edit-report").count() === 1);
  check("report starts locked", await page.locator(".report-sheet.is-editing").count() === 0);
  check("no insert rails until edit mode", await page.locator(".report-insert").count() === 0);
  await page.locator("#edit-report").click();
  await page.waitForSelector(".report-sheet.is-editing");
  check("report edit mode on", await page.locator(".report-sheet.is-editing").count() === 1);
  check("insert rails between sections", await page.locator(".report-insert").count() >= 4);
  check("google drive hint", (await page.locator(".report-edit-bar").innerText()).toLowerCase().includes("google"));
  check("in-progress work is included", await page.locator('[data-invoice-row]').count() >= 2);
  check("seeded sub-line is nested", await page.locator(".invoice-subline").count() >= 2);
  const evidenceRow = page.locator("[data-invoice-row]").first();
  await evidenceRow.locator("[data-add-invoice-evidence]").click();
  await page.locator("#report-link-url").fill("https://drive.google.com/file/d/verify-screenshot/view");
  await page.locator("#report-link-label").fill("Verification screenshot");
  await page.locator("#report-link-form button[type=submit]").click();
  await page.waitForSelector('a:has-text("Verification screenshot")');
  check("row evidence is visible", await page.locator('a:has-text("Verification screenshot")').count() === 1);
  await page.locator('[data-report-slot="after-stats"]:not([data-after])').click();
  await page.waitForSelector("[data-report-block]");
  const note = page.locator("[data-report-block]").first();
  await note.click();
  await page.keyboard.type("Client cover note");
  await page.locator("#done-report-edit").click();
  await page.waitForFunction(() => !document.querySelector(".report-sheet.is-editing"));
  check("leaving edit mode locks the sheet", await page.locator(".report-sheet.is-editing").count() === 0);
  check("note persists after leaving edit", (await page.locator(".report-note").innerText()).includes("Client cover note"));
  check("note is not editable when locked", await page.locator("[data-report-block]").count() === 0);
  await page.getByRole("button", { name: "Project manager" }).click();
  await page.waitForSelector("text=Delivery detail");
  check("other lens does not inherit invoice notes", await page.locator(".report-note").count() === 0);
  await page.getByRole("button", { name: "Invoice settlement" }).click();
  await page.waitForSelector("text=prepared for settlement");
  check("note stays on its lens", (await page.locator(".report-note").innerText()).includes("Client cover note"));
  await page.reload();
  await page.waitForSelector(".task-card");
  await page.getByRole("button", { name: "Reports" }).first().click();
  await page.waitForSelector(".report-sheet");
  check("note persists after reload", (await page.locator(".report-note").innerText()).includes("Client cover note"));

  await page.getByRole("button", { name: "Board" }).first().click();
  await page.waitForSelector("#board-menu-toggle");
  await openBoardMenu(page);
  check("import control", await page.locator("#import-tasks").isVisible());
  check("export control", await page.locator("#export-tasks").isVisible());
  await page.locator("#export-tasks").click();
  await page.waitForSelector("#export-dialog[open]");
  check("clickup export action", await page.locator("#export-clickup").isVisible());
  check("ledgerlane export action", await page.locator("#export-ledgerlane").isVisible());
  check("notion export action", await page.locator("#export-notion").isVisible());
  await page.locator("#export-notion").click();
  await page.waitForSelector("#notion-dialog[open]");
  const notionText = await page.locator("#notion-text").inputValue();
  check("notion text is markdown", notionText.includes("# LedgerLane") && /^- \[[ x]\]/m.test(notionText));
  await page.locator("#cancel-notion").click();
  await page.locator("#notion-dialog").waitFor({ state: "hidden" });
  await page.locator("#project-filter").selectOption("all");
  await page.waitForSelector(".task-card");
  const beforeImport = await page.locator(".task-card").count();
  await openBoardMenu(page);
  await page.locator("#import-tasks").click();
  await page.waitForSelector("#import-dialog[open]");
  check("import append default", await page.locator("#import-form input[name=mode][value=append]").isChecked());
  check("import replace option", await page.locator("#import-form input[name=mode][value=replace]").count() === 1);
  await page.locator("#import-file").setInputFiles({
    name: "clickup-export.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Task Name,Task Content,Status,Priority,List Name,Assignees\nWrite homepage,Hero and CTA,in progress,2,Website,\"[Ada Lovelace]\"\nClose retainers,Q4 settlement,complete,3,Website,Ada Lovelace\n")
  });
  await page.waitForFunction(() => document.querySelector("#import-preview")?.textContent.includes("ClickUp CSV"));
  check("import preview detects ClickUp", (await page.locator("#import-preview").innerText()).includes("ClickUp CSV"));
  await page.locator("#confirm-import").click();
  await page.waitForFunction((was) => document.querySelectorAll(".task-card").length === was + 2, beforeImport);
  check("import append adds tasks", await page.locator(".task-card").count() === beforeImport + 2);
  await openBoardMenu(page);
  await page.locator("#import-tasks").click();
  await page.locator("#import-file").setInputFiles({
    name: "clickup-replace.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Task Name,Status,List Name\nOnly remaining,to do,Website\n")
  });
  await page.locator("#import-form input[name=mode][value=replace]").check();
  await page.locator("#confirm-import").click();
  await page.waitForSelector("#confirm-dialog[open]");
  check("import replace confirms first", (await page.locator("#confirm-message").innerText()).includes("imports 1"));
  await page.locator("#confirm-ok").click();
  await page.waitForFunction(() => document.querySelectorAll(".task-card").length === 1);
  check("import replace swaps the board", await page.locator(".task-card").count() === 1);

  await signOut(page);
  await page.getByLabel("Display name").fill("Viewer User");
  await page.getByLabel("Username").fill(viewerUsername);
  await page.getByLabel("Passphrase").fill("viewer-passphrase");
  await page.locator("#account-type-options summary").click();
  await page.locator("#role-viewer").check();
  await page.getByRole("button", { name: /Create local account/ }).click();
  await page.waitForSelector("[data-role=none]");
  check("viewer waits for invite", await page.locator("#waiting-access").count() === 1);
  check("waiting names an admin", (await page.locator("#waiting-access").innerText()).includes("Morgan Lee"));
  check("waiting has sign out", await page.locator("#waiting-sign-out").isVisible());
  await signOut(page);
  await signIn(page, editorUsername, "local-demo-passphrase");
  await page.waitForSelector("#open-people");
  await inviteToBoard(page, "Viewer User", "viewer");
  await signOut(page);
  await signIn(page, viewerUsername, "viewer-passphrase");
  await page.waitForSelector("[data-role=viewer]");
  check("viewer shell", await page.locator(".app-shell").getAttribute("data-role") === "viewer");
  check("viewer sees board", await page.locator(".task-card").count() >= 1);
  check("viewer has no new task", await page.locator("#new-task").count() === 0);
  check("viewer cannot edit board structure", await page.locator("#edit-board").count() === 0);
  check("viewer has no import", await page.locator("#import-tasks").count() === 0);
  check("viewer has no delete all", await page.locator("#delete-all-tasks").count() === 0);
  check("viewer can copy for notion", await page.locator("#export-tasks").innerText() === "Copy for Notion");
  check("viewer cards are not draggable", await page.locator(".task-card[draggable=true]").count() === 0);
  check("viewer can use tag filters", await page.locator("#tag-filters [data-filter-tag]").count() >= 1);
  check("viewer cannot create tags", await page.locator("#new-tag-form").count() === 0);
  check("viewer cannot color cards", await page.locator(".card-swatch-toggle").count() === 0);
  check("viewer cannot tag from cards", await page.locator(".card-tag-add").count() === 0);
  await page.locator(".task-card").first().click();
  await page.waitForSelector("#task-dialog[open]");
  check("viewer can open a task", await page.locator("#task-dialog").evaluate((dialog) => dialog.open));
  check("viewer task is read-only", await page.locator("#task-form [name=title]").isDisabled());
  check("viewer cannot save", await page.getByRole("button", { name: "Save task" }).count() === 0);
  await page.locator("#task-details summary").click();
  check("viewer cannot add task tag", await page.locator("#add-task-tag").count() === 0);
  check("viewer cannot change card color", await page.locator("#task-color-list input:not([disabled])").count() === 0);
  await page.locator("#cancel-task").click();
  await page.locator("#task-dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Reports" }).first().click();
  await page.waitForSelector(".report-sheet");
  check("viewer can open reports", await page.locator(".report-sheet").count() === 1);
  check("viewer cannot edit report", await page.locator("#edit-report").count() === 0);
  check("viewer cannot type report notes", await page.locator(".report-sheet [contenteditable='true']").count() === 0);
  check("viewer still sees saved notes", (await page.locator(".report-note").innerText()).includes("Client cover note"));
  await page.getByRole("button", { name: "Stakeholder pulse" }).click();
  await page.waitForSelector("text=outcome-oriented");
  check("viewer can change report lens", true);

  await page.locator("#open-people").click();
  await page.waitForSelector("#people-dialog[open]");
  check("viewer sees people", (await page.locator("#people-list").innerText()).includes("Viewer User"));
  check("viewer cannot invite", await page.locator("#invite-people").isHidden());
  await page.locator("#done-people").click();

  await signOut(page);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Display name").fill("Admin User");
  await page.getByLabel("Username").fill(adminUsername);
  await page.getByLabel("Passphrase").fill("admin-passphrase");
  await page.locator("#account-type-options summary").click();
  await page.locator("#role-admin").check();
  await page.getByRole("button", { name: /Create local account/ }).click();
  await page.waitForSelector("[data-role=none]");
  check("admin waits for invite", await page.locator("#waiting-access").count() === 1);
  await signOut(page);
  await signIn(page, editorUsername, "local-demo-passphrase");
  await page.waitForSelector("#open-people");
  await inviteToBoard(page, "Admin User", "admin");
  await signOut(page);
  await signIn(page, adminUsername, "admin-passphrase");
  await page.waitForSelector("[data-role=admin]");
  check("admin shell", await page.locator(".app-shell").getAttribute("data-role") === "admin");
  await page.getByRole("button", { name: "Board" }).first().click();
  await page.waitForSelector("#new-task");
  check("admin can edit", await page.locator("#new-task").count() === 1);

  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/ledgerlane-features.png", fullPage: true });
  await writeFile("artifacts/feature-verification.json", JSON.stringify({ passed: true, results }, null, 2));
  console.log(`\nVerified ${results.length} feature checks. Screenshot: artifacts/ledgerlane-features.png`);
  } finally {
    await browser.close();
  }
} catch (error) {
  await writeFile("artifacts/feature-verification.json", JSON.stringify({ passed: false, results, error: error.message }, null, 2)).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  server.kill();
}
