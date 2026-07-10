'use strict';

const { execSync } = require('child_process');

/**
 * Простой тест загрузки приложения и отображения данных
 * Проверяет HTML/CSS/JS доступность и базовую структуру
 */

describe('Application Loading', () => {
  const BRANCH = process.env.GITHUB_REF_NAME || 'claude/repo-access-status-a865fx';
  const REPO = process.env.GITHUB_REPOSITORY || '021-lab/searchmydata';

  test('should validate all required modules are accessible', () => {
    const modules = [
      'data-model.js',
      'event-bus.js',
      'sync-adapter.js',
      'storage-manager.js',
      'list-interface.js',
      'list-data.js',
      'list-manager.html'
    ];

    console.log('\n📝 Проверка доступности файлов на GitHub:\n');

    for (const module of modules) {
      const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${module}`;
      try {
        const status = execSync(`curl -s -o /dev/null -w "%{http_code}" "${url}"`).toString().trim();
        const ok = status === '200' ? '✓' : '✗';
        console.log(`  ${ok} ${module} (HTTP ${status})`);
        expect(status).toBe('200');
      } catch (err) {
        console.log(`  ✗ ${module} (ERROR)`);
        throw err;
      }
    }

    console.log('\n✅ Все файлы доступны!\n');
  });

  test('should contain required HTML elements', () => {
    const elements = [
      'list-container',
      'add-btn',
      'modal-overlay',
      'input-line1',
      'btn-confirm',
      'list-data.js',
      'list-interface.js'
    ];

    console.log('\n📝 Проверка структуры HTML:\n');

    const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/list-manager.html`;
    const html = execSync(`curl -s "${url}"`).toString();
    console.log(`✓ HTML загружен (${html.length} байт)`);

    console.log('\n✓ Проверка элементов:');
    for (const elem of elements) {
      const found = html.includes(elem);
      const status = found ? '✓' : '✗';
      console.log(`  ${status} ${elem}`);
      expect(found).toBe(true);
    }

    console.log('\n✅ HTML структура валидна!\n');
  });

  test('should contain initial data in list-data.js', () => {
    console.log('\n📝 Проверка исходных данных:\n');

    const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/list-data.js`;
    const jsCode = execSync(`curl -s "${url}"`).toString();
    console.log(`✓ list-data.js загружен (${jsCode.length} байт)`);

    // Проверить базовую структуру
    expect(jsCode).toContain('items');
    expect(jsCode).toContain('id:');
    expect(jsCode).toContain('line1:');
    console.log('✓ Файл содержит структуру данных');

    // Посчитать элементы
    const itemMatches = jsCode.match(/{\s*id:\s*\d+/g);
    const itemCount = itemMatches ? itemMatches.length : 0;
    console.log(`✓ Найдено элементов: ${itemCount}`);
    expect(itemCount).toBeGreaterThan(0);

    // Проверить известные элементы
    const expectedItems = [
      'Молоко 3.2%',
      'Хлеб ржаной',
      'Яблоки'
    ];

    console.log('\n✓ Проверка исходных данных:');
    for (const item of expectedItems) {
      const found = jsCode.includes(item);
      const status = found ? '✓' : '✗';
      console.log(`  ${status} "${item}"`);
      expect(found).toBe(true);
    }

    console.log('\n✅ Исходные данные присутствуют!\n');
  });
});
