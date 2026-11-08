// Browser walkthrough: the public website, the demo flow end to end, and a new
// account from sign-up to its first project. Start the server first, then:
//   BASE_URL=http://localhost:3000 node tests/e2e.mjs
// Works in demo mode (no keys) and with live AI / PayPal sandbox keys.
// Screenshots are written to SHOT_DIR (default: ./test-results).

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SHOTS = process.env.SHOT_DIR || 'test-results';
await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
// Fonts are optional (system fallback); every other failed request is an error.
context.on('requestfailed', (r) => !/fonts\.(googleapis|gstatic)\.com/.test(r.url()) && errors.push(`request failed: ${r.url()}`));
const shot = (name, p = page) => p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const step = (msg) => console.log('✓', msg);

// 0. Public website
await page.goto(BASE);
await page.getByRole('heading', { name: 'Get paid for the work you agreed to.' }).waitFor();
await shot('00-home');
for (const [path, heading] of [['/how-it-works', 'From signed agreement to paid invoice'], ['/pricing', 'Free while ScopePay is in beta'], ['/security', 'Security at ScopePay'], ['/privacy', 'Privacy policy'], ['/terms', 'Terms of use']]) {
  await page.goto(BASE + path);
  await page.getByRole('heading', { level: 1, name: heading }).waitFor();
}
await shot('00-how-it-works');
await page.goto(BASE + '/app');
assert.match(page.url(), /\/signin\?next=\/app$/, 'signed-out visitors are sent to sign in');
step('website pages load; /app requires sign-in or the demo');

// 1. Overview with the seeded sample project
await page.goto(BASE);
await page.getByRole('link', { name: 'Try the live demo' }).first().click();
await page.getByRole('heading', { name: 'Your projects' }).waitFor();
await shot('01-overview');
step('overview loads with sample project');

// 2. Project page: review milestone 2 evidence
await page.getByRole('link', { name: /Website redesign/ }).first().click();
await page.getByRole('heading', { name: 'Acceptance checklist' }).waitFor();
await page.getByRole('button', { name: /Run AI review/ }).click();
await page.locator('.review-bar .chip.green').waitFor({ timeout: 120_000 });
await shot('02-first-review');
const firstCounts = await page.locator('.review-bar .counts').innerText();
assert.match(firstCounts, /missing/i, 'portfolio page should be missing before upload');
step(`first review: ${firstCounts.replace(/\s+/g, ' ')}`);

// 3. Add the missing Portfolio page and the fixed Services page, re-review
await page.getByRole('button', { name: /Portfolio page/ }).click();
await page.locator('.thumb').nth(4).waitFor();
await page.getByRole('button', { name: /Services page \(fixed\)/ }).click();
await page.locator('.thumb').nth(5).waitFor();
await page.getByRole('button', { name: /Re-run/ }).click();
await page.waitForFunction(() => !document.querySelector('.review-bar .chip.red'), null, { timeout: 120_000 });
await shot('03-second-review');
step('portfolio evidence added and review re-run');

// 4. Scope check → change order
await page.getByRole('button', { name: /Can you also add a blog/ }).click();
await page.getByRole('button', { name: /Check against agreement/ }).click();
await page.locator('.scope-item .chip.red', { hasText: 'Out of scope' }).waitFor({ timeout: 120_000 });
await page.getByRole('button', { name: /Send to client for approval/ }).click();
await page.locator('.co .chip.blue', { hasText: 'sent' }).waitFor();
step('blog request flagged out of scope; change order sent');

// 5. Share milestone for acceptance
await page.getByRole('button', { name: /Share for client acceptance/ }).click();
await page.getByText(/Shared with Acme Studio/).waitFor();
await shot('04-shared');
const portalUrl = await page.getByRole('link', { name: /Open client view/ }).getAttribute('href');
step('milestone shared; portal link ' + portalUrl.replace(/#.*/, '#…'));

// 6. Client portal: approve milestone and change order
const portal = await context.newPage();
portal.on('pageerror', (e) => errors.push('portal: ' + e.message));
await portal.goto(portalUrl);
await portal.getByRole('heading', { name: /Development/ }).waitFor();
await shot('05-portal-review', portal);
const reviewSection = portal.locator('section', { hasText: 'Ready for your acceptance' });
const ack = reviewSection.locator('[data-ack]');
if (await ack.count()) await ack.check();
await reviewSection.getByPlaceholder('e.g. Dana Ortiz').fill('Dana Ortiz');
await reviewSection.getByRole('button', { name: /Accept milestone/ }).click();
await reviewSection.waitFor({ state: 'detached' });
const coSection = portal.locator('section', { hasText: 'Change request' });
await coSection.getByPlaceholder('e.g. Dana Ortiz').fill('Dana Ortiz');
await coSection.getByRole('button', { name: /Approve change order/ }).click();
await coSection.waitFor({ state: 'detached' });
await shot('06-portal-approved', portal);
step('client accepted milestone and approved change order');

// 7. Back in workspace: invoice created → send → pay
await page.reload();
await page.getByRole('heading', { name: 'PayPal invoice' }).first().waitFor();
await page.getByRole('button', { name: 'Send via PayPal' }).first().click();
await page.locator('.chip', { hasText: /Sent|Unpaid/ }).first().waitFor({ timeout: 60_000 });
await shot('07-invoice-sent');
const simulate = page.getByRole('button', { name: 'Simulate payment' }).first();
if (await simulate.count()) {
  await simulate.click();
  await page.locator('.callout.green', { hasText: 'Paid' }).waitFor();
  step('invoice sent and (simulated) payment recorded');
} else {
  step('sandbox invoice sent; pay it with the sandbox buyer to finish');
}
await page.getByRole('button', { name: /Draft reminder/ }).count();
await shot('08-paid');

// 8. Invoices page and new-project extraction
await page.goto(BASE + '/app#/invoices');
await page.getByRole('heading', { name: 'Invoices' }).waitFor();
await shot('09-invoices');
await page.goto(BASE + '/app#/new');
await page.getByRole('button', { name: /Use the sample website agreement/ }).click();
await page.getByRole('heading', { name: 'Agreement' }).waitFor({ timeout: 120_000 });
await shot('10-extracted-terms');
if (!(await page.locator('#client-email').inputValue())) await page.locator('#client-email').fill(process.env.CLIENT_EMAIL || 'client@example.com');
await page.getByRole('button', { name: /Confirm terms/ }).click();
await page.getByRole('heading', { name: 'Acceptance checklist' }).waitFor();
step('new project created from extracted terms');

// 9. A new account: sign up, empty workspace, sample project, settings, sign out
const fresh = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const user = await fresh.newPage();
user.on('pageerror', (e) => errors.push('signup: ' + e.message));
const email = `e2e-${Date.now()}@example.com`;
await user.goto(BASE + '/signup');
await user.getByLabel('Your name', { exact: true }).fill('Riley Chen');
await user.getByLabel(/Business name/).fill('Chen Digital');
await user.getByLabel('Email').fill(email);
await user.getByLabel(/^Password/).fill('short');
await user.getByRole('button', { name: 'Create account' }).click();
await user.getByText('Use a password of at least 10 characters.').waitFor();
await user.getByLabel(/^Password/).fill('a much longer password');
await user.getByRole('button', { name: 'Create account' }).click();
await user.getByRole('heading', { name: 'Start with a signed agreement' }).waitFor();
assert.match(await user.locator('.page-band h1').innerText(), /Riley/);
await shot('20-new-account', user);
await user.getByRole('button', { name: 'Add the sample project' }).click();
await user.getByRole('heading', { name: 'Acceptance checklist' }).waitFor();
await user.goto(BASE + '/app#/settings');
await user.getByLabel('Business name').fill('Chen Digital Ltd');
await user.getByRole('button', { name: 'Save profile' }).click();
await user.getByText(/Clients now see Chen Digital Ltd/).waitFor();
await user.getByRole('button', { name: /Account menu/ }).click();
await user.getByRole('menuitem', { name: 'Sign out' }).click();
await user.waitForURL(BASE + '/');
await user.goto(BASE + '/signin');
await user.getByLabel('Email').fill(email);
await user.getByLabel('Password').fill('a much longer password');
await user.getByRole('button', { name: 'Sign in' }).click();
await user.getByRole('heading', { name: 'Your projects' }).waitFor();
assert.equal(await user.locator('.project-row').count(), 1, 'the account keeps its own project only');
await fresh.close();
step('new account: sign up, sample project, settings, sign out and back in');

// 10. Mobile layout has no horizontal overflow
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(BASE);
await page.getByRole('heading', { name: 'Get paid for the work you agreed to.' }).waitFor();
assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, 'mobile overflow on home page');
await shot('10-mobile-home');
await page.goto(BASE + '/app');
await page.getByRole('heading', { name: 'Your projects' }).waitFor();
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
assert.ok((await overflow()) <= 1, `mobile overflow on overview: ${await overflow()}px`);
await shot('11-mobile');
await page.getByRole('link', { name: /Website redesign/ }).first().click();
await page.getByRole('heading', { name: 'Acceptance checklist' }).waitFor();
assert.ok((await overflow()) <= 1, `mobile overflow on project page: ${await overflow()}px`);
await shot('12-mobile-project');
step('mobile layout fits');

assert.deepEqual(errors, [], 'browser errors');
await browser.close();
console.log('\nAll steps passed. Screenshots in', SHOTS);
