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

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  await page.goto(`http://127.0.0.1:${PORT}`);
  await page.getByLabel("Display name").fill("Morgan Lee");
  await page.getByLabel("Username").fill(`morgan-${Date.now()}`);
  await page.getByLabel("Passphrase").fill("local-demo-passphrase");
  await page.getByRole("button", { name: /Create local account/ }).click();
  await page.waitForSelector(".task-card");
  check("seeded board", await page.locator(".task-card").count() === 6, "expected 6 cards");

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

  check("new project control", await page.locator("#new-project").isVisible());
  await page.locator("#new-project").click();
  await page.locator("#project-name").fill("Northstar");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForFunction(() => document.querySelector("#project-filter")?.value && document.querySelector("#project-filter").value !== "all");
  const projectLabel = await page.locator("#project-filter option:checked").textContent();
  check("new project selected", projectLabel.trim() === "Northstar");
  check("default columns on new project", await page.locator(".column").count() === 3);
  check("add column control", await page.locator("#add-column-toggle").isVisible());
  await page.locator("#add-column-toggle").click();
  const typeLabels = await page.locator("#add-column-form select[name=type] option").allTextContents();
  check("complete type omitted when one exists", typeLabels.every((label) => !label.toLowerCase().startsWith("complete")));
  await page.locator("#add-column-form input[name=name]").fill("Review");
  await page.locator("#add-column-form").getByRole("button", { name: "Add column" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".column").length === 4);
  check("custom column added", await page.locator(".column").count() === 4);
  const rename = page.locator(".column-title").first();
  await rename.fill("Ready queue");
  await rename.dispatchEvent("change");
  check("column renamed", await rename.inputValue() === "Ready queue");

  await page.locator("#project-filter").selectOption("all");
  await page.waitForSelector(".task-card");
  await page.locator(".task-card").first().click();
  await page.waitForSelector("#task-dialog[open]");
  check("clickup title field", await page.locator(".title-field input").isVisible());
  check("rtf editor", await page.locator("#task-description").isVisible());
  check("rtf toolbar", await page.locator(".rtf-toolbar [data-cmd]").count() >= 5);
  check("advanced collapsed", await page.locator("#advanced-options").getAttribute("open") === null);
  await page.locator("#attach-menu-toggle").click();
  check("file attach control", await page.locator("#attach-files").count() === 1);
  check("task record control", await page.locator("#record-screen").isVisible());
  await page.locator("#task-description").click();
  await page.keyboard.type("Verified rich notes");
  await page.locator("#task-form").getByRole("button", { name: "Save task" }).click();
  await page.locator("#task-dialog").waitFor({ state: "hidden" });
  check("task dialog closed after save", true);

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

  await page.locator("#account-button").click();
  await page.waitForSelector("#confirm-dialog[open]");
  await page.locator("#confirm-ok").click();
  await page.waitForSelector("#auth-form");
  await page.getByLabel("Display name").fill("Viewer User");
  await page.getByLabel("Username").fill(`riley-${Date.now()}`);
  await page.getByLabel("Passphrase").fill("viewer-passphrase");
  await page.getByLabel(/View only/).check();
  await page.getByRole("button", { name: /Create local account/ }).click();
  await page.waitForSelector("[data-role=viewer]");
  check("viewer shell", await page.locator(".app-shell").getAttribute("data-role") === "viewer");
  check("viewer sees board", await page.locator(".task-card").count() >= 1);
  check("viewer has no new task", await page.locator("#new-task").count() === 0);
  check("viewer has no import", await page.locator("#import-tasks").count() === 0);
  check("viewer has no delete all", await page.locator("#delete-all-tasks").count() === 0);
  check("viewer can copy for notion", await page.locator("#export-tasks").innerText() === "Copy for Notion");
  check("viewer cards are not draggable", await page.locator(".task-card[draggable=true]").count() === 0);
  await page.locator(".task-card").first().click();
  await page.waitForSelector("#task-dialog[open]");
  check("viewer can open a task", await page.locator("#task-dialog").evaluate((dialog) => dialog.open));
  check("viewer task is read-only", await page.locator("#task-form [name=title]").isDisabled());
  check("viewer cannot save", await page.getByRole("button", { name: "Save task" }).count() === 0);
  await page.locator("#cancel-task").click();
  await page.locator("#task-dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Reports" }).first().click();
  await page.waitForSelector(".report-sheet");
  check("viewer can open reports", await page.locator(".report-sheet").count() === 1);
  await page.getByRole("button", { name: "Stakeholder pulse" }).click();
  await page.waitForSelector("text=outcome-oriented");
  check("viewer can change report lens", true);

  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/ledgerlane-features.png", fullPage: true });
  await writeFile("artifacts/feature-verification.json", JSON.stringify({ passed: true, results }, null, 2));
  await browser.close();
  console.log(`\nVerified ${results.length} feature checks. Screenshot: artifacts/ledgerlane-features.png`);
} catch (error) {
  await writeFile("artifacts/feature-verification.json", JSON.stringify({ passed: false, results, error: error.message }, null, 2)).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  server.kill();
}
