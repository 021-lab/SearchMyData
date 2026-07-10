'use strict';

const { test, expect } = require('@playwright/test');

// Тест базовой функциональности
test('should load initial data and display list', async ({ page }) => {
  const URL = process.env.PAGES_URL || 'https://021-lab.github.io/searchmydata/list-manager.html';

  console.log(`\n📝 Загружаю: ${URL}\n`);

  // Загрузить страницу
  await page.goto(URL, { waitUntil: 'networkidle' });

  // Дождаться инициализации приложения
  await page.waitForFunction(() => window.listInterface !== null, { timeout: 10000 });

  console.log('✓ Приложение инициализировано');

  // Получить количество загруженных элементов
  const itemCount = await page.evaluate(() => window.listInterface.model.items.length);
  console.log(`✓ Загружено элементов: ${itemCount}`);

  expect(itemCount).toBeGreaterThan(0);

  // Получить первый элемент
  const firstItem = await page.evaluate(() => {
    const item = window.listInterface.model.items[0];
    return {
      id: item.id,
      line1: item.line1,
      line2: item.line2,
      status: item.status,
      parentId: item.parentId
    };
  });

  console.log('✓ Первый элемент:');
  console.log(`  - ID: ${firstItem.id}`);
  console.log(`  - Текст: ${firstItem.line1}`);
  console.log(`  - Деталь: ${firstItem.line2}`);
  console.log(`  - Статус: ${firstItem.status}`);
  console.log(`  - Родитель: ${firstItem.parentId}`);

  // Проверить что элемент содержит данные
  expect(firstItem.line1).toBeTruthy();
  expect(firstItem.status).toBe('open');

  // Проверить что элементы отображаются в UI
  const visibleItems = page.locator('.list-item-wrapper');
  const count = await visibleItems.count();
  console.log(`✓ Видимых элементов в UI: ${count}`);

  expect(count).toBeGreaterThan(0);

  // Проверить что видны текст элементов
  const firstItemText = await visibleItems.first().locator('.item-line1').textContent();
  console.log(`✓ Текст в UI: "${firstItemText}"`);
  expect(firstItemText).toContain(firstItem.line1);

  // Проверить localStorage
  const savedItems = await page.evaluate(() => {
    const stored = localStorage.getItem('list-state-shopping-list');
    return stored ? JSON.parse(stored).items.length : 0;
  });
  console.log(`✓ В localStorage сохранено элементов: ${savedItems}`);

  console.log('\n✅ Тест пройден! Данные загружены и отображаются\n');
});

// Тест добавления нового элемента
test('should add new item via modal', async ({ page }) => {
  const URL = process.env.PAGES_URL || 'https://021-lab.github.io/searchmydata/list-manager.html';

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.listInterface !== null, { timeout: 10000 });

  console.log('\n📝 Тест добавления элемента\n');

  // Получить текущее количество элементов
  const countBefore = await page.evaluate(() => window.listInterface.model.items.length);
  console.log(`✓ Элементов было: ${countBefore}`);

  // Кликнуть на кнопку +
  await page.click('#add-btn');
  console.log('✓ Нажал кнопку +');

  // Дождаться модального окна
  await page.waitForSelector('.modal-overlay.open', { timeout: 5000 });
  console.log('✓ Модальное окно открылось');

  // Заполнить форму
  const testText = 'Тестовый элемент ' + Date.now();
  await page.fill('#input-line1', testText);
  await page.fill('#input-line2', 'Тестовые детали');
  console.log(`✓ Заполнил форму: "${testText}"`);

  // Подсчитать элементы перед сохранением
  const itemsBefore = await page.evaluate(() => window.listInterface.model.items.length);

  // Нажать кнопку "Добавить"
  await page.click('#btn-confirm');
  console.log('✓ Нажал "Добавить"');

  // Дождаться закрытия модального окна
  await page.waitForFunction(
    () => !document.querySelector('.modal-overlay.open'),
    { timeout: 5000 }
  );
  console.log('✓ Модальное окно закрылось');

  // Дождаться переотрисовки
  await page.waitForTimeout(500);

  // Проверить количество элементов
  const itemsAfter = await page.evaluate(() => window.listInterface.model.items.length);
  console.log(`✓ Элементов стало: ${itemsAfter}`);

  expect(itemsAfter).toBe(itemsBefore + 1);

  // Проверить что новый элемент есть в модели
  const hasNewItem = await page.evaluate((text) => {
    return window.listInterface.model.items.some(i => i.line1 === text);
  }, testText);

  expect(hasNewItem).toBe(true);
  console.log('✓ Новый элемент добавлен в модель');

  // Проверить что элемент видно в UI
  const visibleItems = page.locator('.list-item-wrapper');
  const finalCount = await visibleItems.count();
  console.log(`✓ Видимых элементов в UI: ${finalCount}`);

  console.log('\n✅ Элемент успешно добавлен!\n');
});
