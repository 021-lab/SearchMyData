'use strict';

/**
 * TreeModel - плоский список элементов со статусами и операциями
 *
 * Структура элемента:
 * {
 *   id: number,
 *   line1: string,
 *   line2: string,
 *   parentId: null|number,
 *   status: 'open' | 'in_progress' | 'paused' | 'closed' | 'deleted',
 *   createdAt: timestamp,
 *   updatedAt: timestamp,
 *   tags: string[]
 * }
 */

class TreeModel {
  constructor(initialItems = []) {
    this.items = initialItems;
    this.version = 0;
    this.actionLog = [];
    this.maxId = this.calculateMaxId();
  }

  calculateMaxId() {
    if (this.items.length === 0) return 0;
    return Math.max(...this.items.map(item => item.id || 0));
  }

  getNextId() {
    this.maxId++;
    return this.maxId;
  }

  // ===== ОПЕРАЦИИ =====

  /**
   * Добавить элемент
   */
  addItem(data, parentId = null) {
    const newId = this.getNextId();
    const newItem = {
      id: newId,
      line1: data.line1 || '',
      line2: data.line2 || '',
      parentId,
      status: 'open',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: []
    };

    this.items.push(newItem);
    this.logAction('addItem', { id: newId, line1: data.line1, line2: data.line2, parentId });

    return [{
      op: 'add',
      path: `/items/${this.items.length - 1}`,
      value: newItem
    }];
  }

  /**
   * Переместить элемент (изменить parentId)
   */
  moveItem(itemId, newParentId) {
    const item = this.findItem(itemId);
    if (!item) return [];

    item.parentId = newParentId;
    item.updatedAt = Date.now();
    this.logAction('moveItem', { id: itemId, newParentId });

    const idx = this.findItemIndex(itemId);
    return [{
      op: 'replace',
      path: `/items/${idx}/parentId`,
      value: newParentId
    }];
  }

  /**
   * Отредактировать элемент
   */
  editItem(itemId, updates) {
    const item = this.findItem(itemId);
    if (!item) return [];

    const patches = [];

    if (updates.line1 !== undefined && updates.line1 !== item.line1) {
      item.line1 = updates.line1;
      const idx = this.findItemIndex(itemId);
      patches.push({
        op: 'replace',
        path: `/items/${idx}/line1`,
        value: updates.line1
      });
    }

    if (updates.line2 !== undefined && updates.line2 !== item.line2) {
      item.line2 = updates.line2;
      const idx = this.findItemIndex(itemId);
      patches.push({
        op: 'replace',
        path: `/items/${idx}/line2`,
        value: updates.line2
      });
    }

    if (patches.length > 0) {
      item.updatedAt = Date.now();
      this.logAction('editItem', { id: itemId, ...updates });
    }

    return patches;
  }

  /**
   * Изменить статус
   */
  changeStatus(itemId, newStatus) {
    const item = this.findItem(itemId);
    if (!item) return [];

    item.status = newStatus;
    item.updatedAt = Date.now();
    this.logAction('changeStatus', { id: itemId, status: newStatus });

    const idx = this.findItemIndex(itemId);
    return [{
      op: 'replace',
      path: `/items/${idx}/status`,
      value: newStatus
    }];
  }

  /**
   * Добавить тег
   */
  addTag(itemId, tag) {
    const item = this.findItem(itemId);
    if (!item) return [];

    if (!item.tags) item.tags = [];
    if (!item.tags.includes(tag)) {
      item.tags.push(tag);
      item.updatedAt = Date.now();
      this.logAction('addTag', { id: itemId, tag });
    }

    const idx = this.findItemIndex(itemId);
    return [{
      op: 'replace',
      path: `/items/${idx}/tags`,
      value: item.tags
    }];
  }

  /**
   * Удалить тег
   */
  removeTag(itemId, tag) {
    const item = this.findItem(itemId);
    if (!item || !item.tags) return [];

    const idx = item.tags.indexOf(tag);
    if (idx > -1) {
      item.tags.splice(idx, 1);
      item.updatedAt = Date.now();
      this.logAction('removeTag', { id: itemId, tag });
    }

    const itemIdx = this.findItemIndex(itemId);
    return [{
      op: 'replace',
      path: `/items/${itemIdx}/tags`,
      value: item.tags
    }];
  }

  /**
   * "Удалить" элемент (пометить как deleted)
   */
  deleteItem(itemId) {
    return this.changeStatus(itemId, 'deleted');
  }

  // ===== ЛОГИРОВАНИЕ =====

  logAction(action, data) {
    this.actionLog.push({
      timestamp: Date.now(),
      action,
      data,
      ready: true
    });
  }

  getActionLog() {
    return this.actionLog;
  }

  clearActionLog() {
    this.actionLog = [];
  }

  // ===== ФИЛЬТРАЦИЯ =====

  /**
   * Получить видимые элементы (исключить closed и deleted)
   */
  getVisibleItems() {
    return this.items.filter(item =>
      !['closed', 'deleted'].includes(item.status)
    );
  }

  /**
   * Получить все элементы (включая скрытые)
   */
  getAllItems() {
    return this.items;
  }

  /**
   * Получить элементы с определённым родителем
   */
  getChildren(parentId) {
    return this.getVisibleItems().filter(item => item.parentId === parentId);
  }

  // ===== ПОИСК =====

  findItem(id, tree = this.items) {
    for (const item of tree) {
      if (item.id === id) return item;
    }
    return null;
  }

  findItemIndex(id, tree = this.items) {
    for (let i = 0; i < tree.length; i++) {
      if (tree[i].id === id) return i;
    }
    return -1;
  }

  // ===== СЕРИАЛИЗАЦИЯ =====

  toJSON() {
    return {
      items: this.items,
      version: this.version,
      actionLog: this.actionLog
    };
  }

  static fromJSON(data) {
    const model = new TreeModel(data.items || []);
    model.version = data.version || 0;
    model.actionLog = data.actionLog || [];
    model.maxId = model.calculateMaxId();
    return model;
  }
}
