'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadBrowserClass(context, fileName, className) {
  const code = fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
  vm.runInContext(`${code}\nthis.${className} = ${className};`, context);
}

function createListInterface() {
  const context = vm.createContext({
    console,
    fetch: jest.fn(() => Promise.resolve({ ok: false })),
    localStorage: {
      store: {},
      getItem(key) {
        return this.store[key] || null;
      },
      setItem(key, value) {
        this.store[key] = String(value);
      },
      removeItem(key) {
        delete this.store[key];
      },
      clear() {
        this.store = {};
      }
    }
  });

  loadBrowserClass(context, 'data-model.js', 'TreeModel');
  loadBrowserClass(context, 'event-bus.js', 'EventBus');
  loadBrowserClass(context, 'storage-manager.js', 'StorageManager');
  loadBrowserClass(context, 'sync-adapter.js', 'OfflineAdapter');
  loadBrowserClass(context, 'list-interface.js', 'ListInterface');

  const listInterface = new context.ListInterface({
    listId: 'test-list',
    initialItems: [
      { id: 1, line1: 'Parent', line2: '', parentId: null, status: 'open', tags: [] },
      { id: 2, line1: 'Child', line2: '', parentId: null, status: 'open', tags: [] }
    ],
    syncAdapter: new context.OfflineAdapter()
  });
  listInterface.backgroundSync = jest.fn();
  return listInterface;
}

describe('ListInterface onUserAction payloads', () => {
  test('moveItem payload changes the dragged item parentId', () => {
    const listInterface = createListInterface();

    const patches = listInterface.onUserAction('moveItem', {
      itemId: 2,
      newParentId: 1
    });

    expect(listInterface.model.findItem(2).parentId).toBe(1);
    expect(patches).toEqual([
      { op: 'replace', path: '/items/1/parentId', value: 1 }
    ]);
  });

  test('tag payload toggles through addTag and removeTag actions', () => {
    const listInterface = createListInterface();

    listInterface.onUserAction('addTag', {
      itemId: 2,
      tag: 'Срочно'
    });

    expect(listInterface.model.findItem(2).tags).toContain('Срочно');

    listInterface.onUserAction('removeTag', {
      itemId: 2,
      tag: 'Срочно'
    });

    expect(listInterface.model.findItem(2).tags).not.toContain('Срочно');
  });
});
