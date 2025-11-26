const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:5000', { waitUntil: 'networkidle' });
  await page.fill('#login-email', 'forlandeivan@gmail.com');
  await page.fill('#login-password', 'q1w2e3r4');
  await page.getByTestId('button-login-submit').click();
  await page.getByTestId('link-chat').click();
  await page.waitForSelector('[data-testid="button-new-chat"]');
  await page.waitForTimeout(2000);
  const sidebar = page.locator('aside').first();
  await sidebar.screenshot({ path: 'sidebar-check.png' });
  await browser.close();
})();
