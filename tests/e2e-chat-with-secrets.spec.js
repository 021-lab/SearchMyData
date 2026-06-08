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

test('chat-with-secrets shows dummy response in history after reload', async ({ page }) => {
  const chatPanel = page.locator('#panel-chat');
  const historyPanel = page.locator('#panel-history');

  await page.goto('/chat-with-secrets');

  await page.getByRole('tab', { name: 'Chat' }).click();
  await page.getByPlaceholder('Ask the database context').fill('hello');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(chatPanel.getByText(/dummy response/i)).toBeVisible();

  await page.getByRole('tab', { name: 'History' }).click();
  await expect(historyPanel.getByText('hello', { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(historyPanel.getByText('hello', { exact: true })).toBeVisible();
  await expect(historyPanel.getByText(/dummy response/i)).toBeVisible();
});
