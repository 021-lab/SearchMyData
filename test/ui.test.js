'use strict';

const { test, expect } = require('@playwright/test');

// Get the deployment URL from environment or use default
const BRANCH = process.env.GITHUB_REF_NAME || 'claude/repo-access-status-a865fx';
const REPO = process.env.GITHUB_REPOSITORY || '021-lab/searchmydata';
const DEPLOYMENT_URL = `https://htmlpreview.github.io/?https://raw.githubusercontent.com/${REPO}/${BRANCH}/list-manager.html`;

test.describe('List Manager UI', () => {
  test.beforeEach(async ({ page }) => {
    // Load the htmlpreview deployment
    await page.goto(DEPLOYMENT_URL, {
      waitUntil: 'networkidle'
    });
    // Wait for app initialization
    await page.waitForFunction(() => window.listInterface !== null, { timeout: 5000 });
  });

  test('should render initial list items', async ({ page }) => {
    // Wait for list items to render
    const items = await page.locator('.list-item-wrapper').count();
    expect(items).toBeGreaterThan(0);
  });

  test('should add new item via modal', async ({ page }) => {
    const addBtn = page.locator('#add-btn');
    await addBtn.click();

    // Modal should be open
    const modal = page.locator('.modal-overlay.open');
    await expect(modal).toBeVisible();

    // Fill in the form
    const input1 = page.locator('#input-line1');
    const input2 = page.locator('#input-line2');
    const confirmBtn = page.locator('#btn-confirm');

    await input1.fill('New Test Task');
    await input2.fill('Test details');

    // Count items before
    const countBefore = await page.locator('.list-item-wrapper').count();

    // Submit
    await confirmBtn.click();

    // Wait for modal to close
    await expect(modal).not.toBeVisible({ timeout: 1000 });

    // Wait for re-render
    await page.waitForTimeout(300);

    // Count items after
    const countAfter = await page.locator('.list-item-wrapper').count();
    expect(countAfter).toBe(countBefore + 1);

    // Verify new item is visible
    const lastItem = page.locator('.list-item-wrapper').last();
    await expect(lastItem).toContainText('New Test Task');
  });

  test('should edit existing item', async ({ page }) => {
    // Get first item ID
    const firstItem = page.locator('.list-item-wrapper').first();
    const itemId = await firstItem.getAttribute('data-id');

    // Long press to trigger drag (but we'll skip and try double-tap for edit)
    // Alternative: simulate swipe right to show edit action
    await firstItem.hover();

    // For now, we'll trigger the edit modal manually via JavaScript
    await page.evaluate((id) => {
      const item = window.listInterface.model.findItem(parseInt(id));
      if (item) openModal('edit', item.id);
    }, itemId);

    // Modal should be open
    const modal = page.locator('.modal-overlay.open');
    await expect(modal).toBeVisible();

    // Check that inputs are populated
    const input1 = page.locator('#input-line1');
    const currentValue = await input1.inputValue();
    expect(currentValue.length).toBeGreaterThan(0);

    // Edit the value
    await input1.fill('Edited Task');
    const confirmBtn = page.locator('#btn-confirm');
    await confirmBtn.click();

    // Modal should close
    await expect(modal).not.toBeVisible({ timeout: 1000 });

    // Verify change is visible
    await page.waitForTimeout(300);
    await expect(firstItem).toContainText('Edited Task');
  });

  test('should delete item', async ({ page }) => {
    const countBefore = await page.locator('.list-item-wrapper').count();

    // Get first item
    const firstItem = page.locator('.list-item-wrapper').first();
    const itemId = await firstItem.getAttribute('data-id');

    // Trigger delete via JavaScript (simulate swipe action)
    await page.evaluate((id) => {
      window.listInterface.onUserAction('deleteItem', { itemId: parseInt(id) });
    }, itemId);

    // Wait for animation
    await page.waitForTimeout(400);

    // Count should decrease
    const countAfter = await page.locator('.list-item-wrapper').count();
    expect(countAfter).toBeLessThan(countBefore);
  });

  test('should persist state to localStorage', async ({ page }) => {
    // Add an item
    await page.evaluate(() => {
      window.listInterface.onUserAction('addItem', {
        data: { line1: 'localStorage Test', line2: 'Should persist' },
        parentId: null
      });
    });

    // Get the item count
    const countBefore = await page.evaluate(() => window.listInterface.model.items.length);

    // Reload page
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.listInterface !== null, { timeout: 5000 });

    // Check if item persists
    const countAfter = await page.evaluate(() => window.listInterface.model.items.length);
    expect(countAfter).toBe(countBefore);

    // Verify the item is there
    const hasItem = await page.evaluate(() =>
      window.listInterface.model.items.some(i => i.line1 === 'localStorage Test')
    );
    expect(hasItem).toBe(true);
  });

  test('should change item status', async ({ page }) => {
    // Get first item
    const firstItem = page.locator('.list-item-wrapper').first();
    const itemId = await firstItem.getAttribute('data-id');

    // Change status to closed
    await page.evaluate((id) => {
      window.listInterface.onUserAction('changeStatus', {
        itemId: parseInt(id),
        newStatus: 'closed'
      });
    }, itemId);

    await page.waitForTimeout(300);

    // Item should no longer be visible
    const visibleCount = await page.locator('.list-item-wrapper').count();
    const countAfter = await page.evaluate(() => window.listInterface.model.items.length);

    // Visible count should be less than total count
    expect(visibleCount).toBeLessThan(countAfter);
  });

  test('should add tags to item', async ({ page }) => {
    // Get first item ID
    const firstItem = page.locator('.list-item-wrapper').first();
    const itemId = await firstItem.getAttribute('data-id');

    // Add tag
    await page.evaluate((id) => {
      window.listInterface.onUserAction('addTag', {
        itemId: parseInt(id),
        tag: 'urgent'
      });
    }, itemId);

    await page.waitForTimeout(300);

    // Verify tag is visible
    const hasTag = await page.evaluate(() => {
      const item = window.listInterface.model.items[0];
      return item.tags && item.tags.includes('urgent');
    });
    expect(hasTag).toBe(true);
  });

  test('should emit events on actions', async ({ page }) => {
    // Track emitted events
    const events = await page.evaluate(() => {
      const emittedEvents = [];
      const originalEmit = window.listInterface.bus.emit;
      window.listInterface.bus.emit = function(event, data) {
        emittedEvents.push(event);
        return originalEmit.call(this, event, data);
      };
      return window.__emittedEvents = emittedEvents;
    });

    // Add an item
    await page.evaluate(() => {
      window.listInterface.onUserAction('addItem', {
        data: { line1: 'Event Test', line2: '' },
        parentId: null
      });
    });

    await page.waitForTimeout(300);

    // Check events were emitted
    const emittedEvents = await page.evaluate(() => window.__emittedEvents);
    expect(emittedEvents).toContain('addItem');
  });

  test('should display sync status', async ({ page }) => {
    // Trigger sync
    await page.evaluate(() => {
      window.listInterface.backgroundSync();
    });

    // Wait a bit for sync to process
    await page.waitForTimeout(500);

    // Check that sync status element exists
    const diagStatus = page.locator('#diag-status');
    await expect(diagStatus).toBeVisible();
  });
});
