import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const server = spawn("python3", ["-m", "http.server", "4174"], { stdio: "ignore" });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForServer() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { if ((await fetch("http://127.0.0.1:4174")).ok) return; } catch { /* Server is still starting. */ }
    await wait(150);
  }
  throw new Error("Static server did not become ready");
}

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto("http://127.0.0.1:4174");
  await page.getByLabel("Display name").fill("Morgan Lee");
  await page.getByLabel("Username").fill(`morgan-${Date.now()}`);
  await page.getByLabel("Passphrase").fill("local-demo-passphrase");
  await page.getByRole("button", { name: /Create local account/ }).click();
  await page.waitForSelector(".task-card");
  if (await page.locator(".task-card").count() !== 6) throw new Error("Expected six seeded tasks");
  await page.getByRole("button", { name: "Engagements" }).first().click();
  await page.getByRole("button", { name: "New engagement" }).click();
  await page.getByLabel("Engagement name").fill("Autumn programme support");
  await page.getByLabel("One-time").check();
  await page.locator("#engagement-advanced summary").click();
  await page.getByLabel(/Amount \(USD/).fill("2400");
  await page.getByRole("button", { name: "Create work list" }).click();
  await page.waitForSelector("#quick-engagement-task");
  await page.getByLabel("Add a task").fill("Prepare October delivery plan");
  await page.getByLabel("Add a task").press("Enter");
  await page.waitForFunction(() => document.querySelectorAll("#engagement-task-list .engagement-task-row").length === 1);
  await page.getByLabel("Add a task").fill("Send weekly progress pulse");
  await page.locator("#quick-engagement-details summary").click();
  await page.locator("#quick-engagement-timing").selectOption("ongoing");
  await page.getByRole("button", { name: "Add task" }).click();
  await page.waitForFunction(() => document.querySelectorAll("#engagement-task-list .engagement-task-row").length === 2);
  await page.locator("#engagement-share-toggle").click();
  if (!(await page.locator("#print-engagement").innerText()).includes("save as PDF")) throw new Error("Expected engagement print/PDF export");
  await page.locator("#engagement-share-toggle").click();
  await page.emulateMedia({ media: "print" });
  if (await page.locator(".engagement-index").isVisible() || await page.locator(".quick-engagement-task").isVisible() || !(await page.locator(".engagement-task-list").isVisible())) {
    throw new Error("Expected the engagement print sheet without navigation or quick add controls");
  }
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("button", { name: "Save as project board" }).click();
  await page.waitForSelector("#project-filter");
  if (await page.locator(".task-card").count() !== 2) throw new Error("Expected engagement tasks to become To do cards");
  await page.getByRole("button", { name: "Engagements" }).first().click();
  await page.waitForSelector("text=Project board saved");
  if (!(await page.locator(".engagement-summary").innerText()).toLowerCase().includes("one-time")) throw new Error("Expected saved engagement terms");
  await page.getByRole("button", { name: "New engagement" }).click();
  await page.getByLabel("Engagement name").fill("Neighbourhood advocacy");
  await page.getByLabel("Barter").check();
  await page.locator("#engagement-advanced summary").click();
  if (await page.locator("#engagement-amount-field").isVisible()) throw new Error("Barter should not expose a cash amount by default");
  await page.getByLabel(/What is exchanged/).fill("Workshop facilitation for venue access");
  await page.getByRole("button", { name: "Create work list" }).click();
  await page.getByRole("button", { name: "Save as project board" }).click();
  await page.waitForSelector("#project-filter");
  const barterProjectId = await page.locator("#project-filter").inputValue();
  await page.getByRole("button", { name: "Reports" }).click();
  await page.getByRole("button", { name: "Invoice settlement" }).click();
  await page.locator("#report-no-projects").click();
  await page.locator(`[data-report-project="${barterProjectId}"]`).check();
  await page.waitForSelector("text=Non-cash arrangements recorded without a cash invoice.");
  const barterReport = await page.locator(".report-sheet").innerText();
  if (!barterReport.includes("Workshop facilitation for venue access") || barterReport.includes("$")) throw new Error("Expected a non-cash barter settlement record");
  await page.getByRole("button", { name: "Project manager" }).click();
  await page.waitForSelector("text=Delivery detail");
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/ledgerlane-smoke.png", fullPage: true });
  await browser.close();
  console.log("Browser smoke passed: sign-up, follow-on engagement conversion, reports, and screenshot.");
} finally {
  server.kill();
}
