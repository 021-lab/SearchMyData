'use strict';

const { test, expect } = require('@playwright/test');
const { startFakeTerminusDb } = require('./fake-terminusdb');

let fakeDb;
let app;
const TEST_PORT = 3100;

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    if (!server) {
      resolve();
      return;
    }

    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function itemBox(page, id) {
  const locator = page.locator(`.list-item-wrapper[data-id="${id}"] .list-item`);
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Item ${id} has no bounding box`);
  return box;
}

async function swipeRightAction(page, id, action) {
  const dyByAction = {
    nest: -95,
    view: -30,
    edit: 30,
    delete: 95,
  };
  const box = await itemBox(page, id);
  const startX = box.x + 28;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.waitForTimeout(50);
  await page.mouse.move(startX + 150, startY + dyByAction[action], { steps: 12 });
  await page.waitForTimeout(50);
  await page.mouse.up();
  await page.waitForTimeout(350);
}

async function swipeLeftForFirstTag(page, id) {
  const box = await itemBox(page, id);
  const startX = box.x + box.width - 28;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.waitForTimeout(50);
  await page.mouse.move(startX - 160, startY - 150, { steps: 14 });
  await page.waitForTimeout(50);
  await page.mouse.up();
  await page.waitForTimeout(350);
}

async function swipeLeftForLastTag(page, id) {
  const box = await itemBox(page, id);
  const startX = box.x + box.width - 28;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.waitForTimeout(50);
  await page.mouse.move(startX - 160, startY + 150, { steps: 14 });
  await page.waitForTimeout(50);
  await page.mouse.up();
  await page.waitForTimeout(350);
}

async function longPressDrag(page, id, dx, dy) {
  const box = await itemBox(page, id);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.waitForTimeout(450);
  await page.mouse.move(startX + dx, startY + dy, { steps: 18 });
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(400);
}

async function addRoot(page, line1, line2) {
  await page.locator('#add-btn').click();
  await page.locator('#input-line1').fill(line1);
  await page.locator('#input-line2').fill(line2);
  await page.locator('#btn-confirm').click();
  await page.waitForTimeout(250);
}

async function waitForSync(page) {
  await page.evaluate(() => window.__searchMyDataTest.waitForSync());
}

async function assertBrowserEqualsServer(page) {
  const result = await page.evaluate(() => window.__searchMyDataTest.checkDocumentAgainstServer());
  expect(result.ok).toBe(true);
}

test.beforeEach(async () => {
  fakeDb = await startFakeTerminusDb();

  process.env.TERMINUS_URL = fakeDb.url;
  process.env.TERMINUS_TEAM = 'admin';
  process.env.TERMINUS_DB = 'searchmydata';
  process.env.TERMINUS_USER = 'admin';
  process.env.TERMINUS_PASS = 'root';
  process.env.PORT = String(TEST_PORT);

  const { createServer } = require('../server');
  app = createServer();
  await listen(app, TEST_PORT);
});

test.afterEach(async () => {
  await close(app);
  app = undefined;

  if (fakeDb) {
    await fakeDb.stop();
    fakeDb = undefined;
  }

  delete process.env.TERMINUS_URL;
  delete process.env.TERMINUS_TEAM;
  delete process.env.TERMINUS_DB;
  delete process.env.TERMINUS_USER;
  delete process.env.TERMINUS_PASS;
  delete process.env.PORT;
});

test('initial load renders all database items as a nested list', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.list-item-wrapper')).toHaveCount(31);
  await expect(page.locator('.list-item-wrapper[data-id="26"]')).toHaveAttribute('data-level', '1');
  await expect(page.locator('.list-item-wrapper[data-id="27"]')).toHaveAttribute('data-level', '1');
});

test('roundtrip scenario keeps browser state equal to server before and after reload', async ({ page }) => {
  await page.goto('/');
  await waitForSync(page);

  await addRoot(page, 'Корневой e2e', 'создан через HTTP');
  await swipeRightAction(page, 2, 'nest');
  await page.locator('#input-line1').fill('Вложенный e2e');
  await page.locator('#input-line2').fill('добавлен под Хлеб');
  await page.locator('#btn-confirm').click();
  await page.waitForTimeout(250);

  await swipeRightAction(page, 33, 'view');
  await expect(page.locator('#modal-title')).toHaveText('Просмотр');
  await page.locator('#btn-cancel').click();

  await swipeRightAction(page, 33, 'edit');
  await page.locator('#input-line1').fill('Вложенный e2e обновлён');
  await page.locator('#input-line2').fill('после редактирования');
  await page.locator('#btn-confirm').click();
  await page.waitForTimeout(250);

  await swipeLeftForFirstTag(page, 33);
  await swipeLeftForLastTag(page, 33);

  await page.locator('.list-item-wrapper[data-id="2"] .list-item').click();
  await page.waitForTimeout(150);
  await page.locator('.list-item-wrapper[data-id="2"] .list-item').click();
  await page.waitForTimeout(150);

  await longPressDrag(page, 4, 0, -90);
  await longPressDrag(page, 27, 90, 0);

  await swipeRightAction(page, 33, 'delete');
  await page.locator('#undo-btn').click();
  await expect(page.locator('.list-item-wrapper[data-id="33"]')).toBeVisible();

  await waitForSync(page);
  await assertBrowserEqualsServer(page);

  await page.reload();
  await waitForSync(page);
  await assertBrowserEqualsServer(page);
});
