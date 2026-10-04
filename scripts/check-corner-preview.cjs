// Run after build:corner-preview. Browser dependencies are supplied by the QA environment.
const { chromium } = require(process.env.CORNER_PLAYWRIGHT);
const binary = require(process.env.CORNER_CHROMIUM).default;
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
(async () => {
  const browser = await chromium.launch({ executablePath: await binary.executablePath(), headless: true, args: binary.args });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [], remote = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (/^https?:/.test(r.url())) remote.push(r.url()); });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../preview-dist/Resident_Corner_Local_Preview.html')).href);
    for (const role of ['resident', 'staff', 'admin']) {
      await page.getByLabel('ทดลองบทบาท', { exact: true }).selectOption(role);
      await page.getByRole('heading', { name: 'Resident Corner', exact: true }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth), true);
      if (role === 'staff') {
        await page.getByRole('button', { name: 'ประเมิน', exact: true }).first().click();
        await page.getByText('ขอบเขตรอบนี้: หน้าแรกและเมนู', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'กลับหน้าแรก', exact: true }).click();
      }
      const nav = page.locator('nav');
      for (const name of await nav.locator('button').allTextContents()) {
        await nav.getByRole('button', { name, exact: true }).click();
        assert.ok(await page.locator('main h1').textContent());
      }
      await nav.getByRole('button', { name: 'หน้าแรก', exact: true }).click();
      await page.getByLabel('ทดลองไม่มีรายการ').check();
      assert.deepEqual(await page.locator('.corner-metrics strong').allTextContents(), ['0', '0']);
      await page.getByLabel('ทดลองไม่มีรายการ').uncheck();
    }
    await page.getByLabel('ทดลองบทบาท', { exact: true }).selectOption('resident');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.mouse.move(385, 0);
    await page.waitForTimeout(300);
    await page.screenshot({ path: '/tmp/corner-preview-mobile-final.png', fullPage: true });
    assert.equal(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth), true);
    await page.getByRole('button', { name: 'เปิดเมนู', exact: true }).click();
    await page.locator('nav').getByRole('button', { name: 'บัญชีที่เชื่อมต่อ', exact: true }).click();
    assert.equal(await page.locator('.app-sidebar.open').count(), 0);
    await page.getByRole('button', { name: 'กลับหน้าแรก', exact: true }).click();
    await page.getByRole('button', { name: 'เปิดเมนู', exact: true }).click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.app-sidebar.open').count(), 0);
    await page.getByRole('button', { name: 'ออกจากระบบ', exact: true }).click();
    await page.getByRole('button', { name: 'กลับเข้า preview', exact: true }).click();
    assert.deepEqual(errors, []);
    assert.deepEqual(remote, []);
    console.log('PASS: roles, navigation, empty states, mobile menu/Escape, simulated logout; zero page errors and HTTP requests.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
