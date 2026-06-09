/** Playwright capture — run via: node docs/assets/capture-demo.js */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname);
const URL = process.env.RAILMIND_URL || "http://localhost:3000";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(URL, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(2500);

  const enter = page.getByRole("button", { name: /Enter control room/i });
  if (await enter.isVisible().catch(() => false)) await enter.click();
  await page.waitForTimeout(600);

  await page.screenshot({ path: path.join(OUT, "control-room.png") });

  const frames = [];
  async function shot(name) {
    const p = path.join(OUT, `_frame_${name}.png`);
    await page.screenshot({ path: p });
    frames.push(p);
  }

  await shot("01");
  await page.getByRole("button", { name: /▶ Demo|DEMO/i }).first().click();
  await page.waitForTimeout(500);
  await page.getByText("Block ghat").click();
  await page.waitForTimeout(3500);
  await shot("02");
  await page.waitForTimeout(4500);
  await shot("03");
  await page.waitForTimeout(5000);
  await shot("04");
  await page.waitForTimeout(5500);
  await shot("05");

  await page.screenshot({ path: path.join(OUT, "demo-conflicts.png") });
  await page.screenshot({ path: path.join(OUT, "ai-panel.png") });

  fs.writeFileSync(path.join(OUT, "_frames.json"), JSON.stringify(frames));
  await browser.close();
  console.log("Captured", frames.length, "frames");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
