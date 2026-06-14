/** Playwright capture — run via: node docs/assets/capture-demo.js
 *  Captures real satellite + 3D follow + moving trains, then Demo Mode conflict flow.
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname);
const URL = process.env.RAILMIND_URL || "http://localhost:3000";
const FRAME_MS = Number(process.env.RAILMIND_FRAME_MS || 1200);

async function enterControlRoom(page) {
  await page.goto(URL, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(2000);
  const enter = page.getByRole("button", { name: /Enter control room/i });
  if (await enter.isVisible().catch(() => false)) await enter.click();
  await page.waitForTimeout(1500);
  await page.locator(".india-map").waitFor({ state: "attached", timeout: 60000 });
  await page.waitForTimeout(2000);
}

async function switchCorridor(page, name) {
  const btn = page.getByRole("button", { name: new RegExp(`^${name}$`, "i") }).first();
  if (!(await btn.isVisible().catch(() => false))) return;
  await Promise.all([
    page.waitForLoadState("networkidle").catch(() => {}),
    btn.click()
  ]);
  await page.waitForTimeout(2500);
  const enter = page.getByRole("button", { name: /Enter control room/i });
  if (await enter.isVisible().catch(() => false)) await enter.click();
  await page.waitForTimeout(2000);
  await page.locator(".india-map").waitFor({ state: "attached", timeout: 60000 });
}

async function enableMapModes(page) {
  const sat = page.getByRole("button", { name: "SAT" });
  if (await sat.isVisible().catch(() => false)) {
    await sat.click();
    await page.waitForTimeout(3500);
  }
  const rail = page.getByRole("button", { name: "RAIL" });
  if (await rail.isVisible().catch(() => false)) {
    await rail.click();
    await page.waitForTimeout(400);
    const infra = page.getByRole("button", { name: /Infrastructure/i });
    if (await infra.isVisible().catch(() => false)) await infra.click();
    await page.waitForTimeout(800);
    await page.mouse.click(720, 450);
  }
  const threeD = page.getByRole("button", { name: "3D" });
  if (await threeD.isVisible().catch(() => false)) {
    await threeD.click();
    await page.waitForTimeout(4500);
  }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await enterControlRoom(page);
  await switchCorridor(page, "Mumbai");
  await enableMapModes(page);

  const frames = [];
  async function shot(name) {
    const p = path.join(OUT, `_frame_${name}.png`);
    await page.screenshot({ path: p });
    frames.push(p);
    console.log("  frame", name);
  }

  // Hero still — satellite + rail infra + 3D follow on a moving train
  await page.screenshot({ path: path.join(OUT, "control-room.png") });
  await page.screenshot({ path: path.join(OUT, "live-satellite.png") });

  // GIF sequence: capture trains in motion on real satellite imagery
  for (let i = 1; i <= 10; i++) {
    await shot(String(i).padStart(2, "0"));
    await page.waitForTimeout(FRAME_MS);
  }

  // Demo Mode — block ghat conflict + AI pipeline
  const demoBtn = page.getByRole("button", { name: /▶ Demo|DEMO/i }).first();
  if (await demoBtn.isVisible().catch(() => false)) {
    await demoBtn.click();
    await page.waitForTimeout(500);
    const block = page.getByText("Block ghat");
    if (await block.isVisible().catch(() => false)) await block.click();
    await page.waitForTimeout(4000);
    await shot("demo_01");
    await page.waitForTimeout(5000);
    await shot("demo_02");
    await page.waitForTimeout(5500);
    await shot("demo_03");
  }

  await page.screenshot({ path: path.join(OUT, "demo-conflicts.png") });
  await page.screenshot({ path: path.join(OUT, "ai-panel.png") });

  fs.writeFileSync(path.join(OUT, "_frames.json"), JSON.stringify(frames));
  await browser.close();
  console.log("Captured", frames.length, "GIF frames + PNG screenshots");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
