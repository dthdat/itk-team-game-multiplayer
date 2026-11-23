import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const baseline = process.argv.includes('--baseline');
const url = baseline ? new URL('../baseline/ITK-BGSV Prompt Works_backup_2026-11-09_10-25-05-288.html', import.meta.url).href : process.env.TEST_URL || 'http://127.0.0.1:3000';
const browsers = [];
const pages = [];
const errors = [];
await mkdir('reports', { recursive: true });
try {
  for (let index = 0; index < 2; index++) {
    browsers.push(await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }));
  }
  pages.push(...await Promise.all(browsers.map(browser => browser.newPage({ viewport: { width: 1440, height: 900 } }))));
  for (const [index, page] of pages.entries()) {
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.locator('#name-in').fill(`Baseline ${index + 1}`);
    await page.locator('.disc').first().click();
    await page.locator('#clockin').click();
    await page.waitForTimeout(1500);
    await page.locator('#net-status').filter({ hasText: 'Online' }).waitFor({ timeout: 10000 });
  }
  await pages[0].keyboard.down('w');
  await pages[0].waitForTimeout(700);
  await pages[0].keyboard.up('w');
  await pages[1].waitForTimeout(1500);
  const users = await Promise.all(pages.map(page => page.locator('#s-list').innerText()));
  await pages[0].screenshot({ path: `reports/${baseline ? 'baseline' : 'current'}-hud.png` });
  await pages[0].locator('#hint').click();
  await pages[0].locator('#m-text').fill('You are a brake NVH engineer reviewing a low speed squeal on a test vehicle. Compare likely causes using the operating conditions, request the missing temperature and wheel speed data, and distinguish evidence from assumptions. Return a short prioritized table with a safe diagnostic sequence. Do not invent measurements, prescribe unsafe road tests, or declare a root cause without evidence.');
  await pages[0].locator('#m-submit').click();
  await pages[0].locator('#r-verdict').waitFor({ state: 'visible' });
  await pages[0].locator('#r-verdict').filter({ hasText: 'Not evaluated' }).waitFor();
  await pages[0].screenshot({ path: `reports/${baseline ? 'baseline' : 'current'}-mission.png` });
  await pages[0].setViewportSize({ width: 390, height: 844 });
  const mobile = await pages[0].evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, sheet: document.querySelector('#mission .sheet').scrollWidth, sheetClient: document.querySelector('#mission .sheet').clientWidth }));
  await pages[0].screenshot({ path: `reports/${baseline ? 'baseline' : 'current'}-mobile.png` });
  const review = { verdict: await pages[0].locator('#r-verdict').innerText(), score: await pages[0].locator('#r-score').innerText(), reward: await pages[0].locator('#r-xp').innerText() };
  const report = { at: new Date().toISOString(), baseline, separateBrowserProcesses: true, separateMachines: false, users, review, mobile, mobileNoHorizontalOverflow: mobile.document <= mobile.viewport && mobile.sheet <= mobile.sheetClient, errors, bothListed: users.every(text => text.includes('Baseline 1') && text.includes('Baseline 2')), mockAwardsNoXP: review.verdict.toLowerCase() === 'not evaluated' && !review.reward.includes('+') };
  await writeFile(`reports/${baseline ? 'baseline' : 'current'}-browser.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.bothListed || !report.mockAwardsNoXP || !report.mobileNoHorizontalOverflow || errors.length) process.exitCode = 1;
} finally {
  if (!baseline) await Promise.all(pages.map(page => page.evaluate(async () => {
    try {
      const session=await fetch('/api/session').then(response=>response.json());
      await fetch('/api/session',{method:'DELETE',headers:{'content-type':'application/json','x-csrf-token':session.csrfToken},body:'{}'});
      localStorage.removeItem('apex-prompt-works-v1');
    } catch {}
  }).catch(() => {})));
  await Promise.all(browsers.map(browser => browser.close()));
}