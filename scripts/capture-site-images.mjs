// Captures the product screenshots used on the website (public/img/*.jpg)
// from a running ScopePay server. Run it with an AI key configured so the
// screenshots show real AI verdicts rather than the demo rules.
// Usage: npm start & BASE_URL=http://localhost:3000 node scripts/capture-site-images.mjs

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = 'public/img';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext({ viewport: { width: 1280, height: 811 }, deviceScaleFactor: 1.5 });
const page = await context.newPage();
// Crops to one panel so the text stays readable on the website.
const save = async (name, p, selector, maxHeight = 760) => {
  await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  const box = await p.locator(selector).first().boundingBox();
  const pad = 14;
  await p.screenshot({
    path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 84, fullPage: true,
    clip: { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: Math.min(box.height + pad * 2, maxHeight) },
  });
  console.log(`wrote ${OUT}/${name}.jpg`);
};

await page.goto(`${BASE}/demo`);
await page.getByRole('link', { name: /Website redesign/ }).first().click();
await page.getByRole('button', { name: /Run AI review/ }).click();
await page.locator('.review-bar .chip.green').waitFor();
await save('review', page, 'section[aria-label="Acceptance checklist"]');

await page.getByRole('button', { name: /Portfolio page/ }).click();
await page.locator('.thumb').nth(4).waitFor();
await page.getByRole('button', { name: /Services page \(fixed\)/ }).click();
await page.locator('.thumb').nth(5).waitFor();
await page.getByRole('button', { name: /Re-run/ }).click();
await page.waitForFunction(() => !document.querySelector('.review-bar .chip.red'));
await page.getByRole('button', { name: /Share for client acceptance/ }).click();
const portalUrl = await page.getByRole('link', { name: /Open client view/ }).getAttribute('href');

const portal = await context.newPage();
await portal.goto(portalUrl);
await portal.getByRole('heading', { name: /Development/ }).waitFor();
await save('portal', portal, 'section[aria-label^="Review"]');
const review = portal.locator('section', { hasText: 'Ready for your acceptance' });
await review.getByPlaceholder('e.g. Dana Ortiz').fill('Dana Ortiz');
await review.getByRole('button', { name: /Accept milestone/ }).click();
await review.waitFor({ state: 'detached' });

await page.reload();
await page.getByRole('button', { name: 'Send via PayPal' }).first().click();
await page.getByRole('button', { name: 'Simulate payment' }).first().click();
await page.locator('.callout.green', { hasText: 'Paid' }).waitFor();
await save('invoice', page, '.grid-2 .stack > section:first-child');

await page.goto(`${BASE}/app#/new`);
await page.getByRole('button', { name: /Use the sample website agreement/ }).click();
await page.getByRole('heading', { name: 'Agreement' }).waitFor();
await save('extract', page, '.grid-2 > .stack', 640);

await browser.close();
