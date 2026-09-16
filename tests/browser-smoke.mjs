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
  await page.getByRole("button", { name: "Reports" }).click();
  await page.getByRole("button", { name: "Project manager" }).click();
  await page.waitForSelector("text=Delivery detail");
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/ledgerlane-smoke.png", fullPage: true });
  await browser.close();
  console.log("Browser smoke passed: sign-up, seeded board, reports, and screenshot.");
} finally {
  server.kill();
}
