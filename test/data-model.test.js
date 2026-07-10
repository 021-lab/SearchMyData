'use strict';

const TreeModel = require('../data-model.js');

describe('TreeModel', () => {
  let model;

  beforeEach(() => {
    model = new TreeModel();
  });

  describe('addItem', () => {
    test('should add item to root level', () => {
      const patches = model.addItem({ line1: 'Task 1', line2: 'Details' });
      expect(model.items).toHaveLength(1);
      expect(model.items[0].line1).toBe('Task 1');
      expect(model.items[0].parentId).toBeNull();
      expect(model.items[0].status).toBe('open');
      expect(patches).toHaveLength(1);
      expect(patches[0].op).toBe('add');
    });

    test('should add nested item with parentId', () => {
      model.addItem({ line1: 'Parent' });
      const parentId = model.items[0].id;
      const patches = model.addItem({ line1: 'Child' }, parentId);
      expect(model.items).toHaveLength(2);
      expect(model.items[1].parentId).toBe(parentId);
      expect(patches).toHaveLength(1);
    });

    test('should increment item ID', () => {
      model.addItem({ line1: 'First' });
      model.addItem({ line1: 'Second' });
      expect(model.items[0].id).not.toBe(model.items[1].id);
      expect(model.items[1].id).toBeGreaterThan(model.items[0].id);
    });

    test('should initialize timestamps', () => {
      const before = Date.now();
      model.addItem({ line1: 'Task' });
      const after = Date.now();
      const item = model.items[0];
      expect(item.createdAt).toBeGreaterThanOrEqual(before);
      expect(item.createdAt).toBeLessThanOrEqual(after);
      expect(item.updatedAt).toEqual(item.createdAt);
    });

    test('should log action', () => {
      model.addItem({ line1: 'Task', line2: 'Details' });
      expect(model.actionLog).toHaveLength(1);
      expect(model.actionLog[0].action).toBe('addItem');
      expect(model.actionLog[0].data.line1).toBe('Task');
    });
  });

  describe('editItem', () => {
    test('should edit existing item', () => {
      model.addItem({ line1: 'Old Title', line2: 'Old Details' });
      const itemId = model.items[0].id;
      const patches = model.editItem(itemId, { line1: 'New Title' });
      expect(model.items[0].line1).toBe('New Title');
      expect(patches).toHaveLength(1);
      expect(patches[0].op).toBe('replace');
    });

    test('should not edit non-existent item', () => {
      const patches = model.editItem(999, { line1: 'New' });
      expect(patches).toHaveLength(0);
    });

    test('should update both line1 and line2', () => {
      model.addItem({ line1: 'Old1', line2: 'Old2' });
      const itemId = model.items[0].id;
      const patches = model.editItem(itemId, { line1: 'New1', line2: 'New2' });
      expect(patches).toHaveLength(2);
      expect(model.items[0].line1).toBe('New1');
      expect(model.items[0].line2).toBe('New2');
    });

    test('should update updatedAt timestamp', () => {
      model.addItem({ line1: 'Task' });
      const itemId = model.items[0].id;
      const createdAt = model.items[0].updatedAt;
      model.editItem(itemId, { line1: 'Updated' });
      expect(model.items[0].updatedAt).toBeGreaterThanOrEqual(createdAt);
    });
  });

  describe('changeStatus', () => {
    test('should change item status', () => {
      model.addItem({ line1: 'Task' });
      const itemId = model.items[0].id;
      const patches = model.changeStatus(itemId, 'closed');
      expect(model.items[0].status).toBe('closed');
      expect(patches).toHaveLength(1);
    });

    test('should return empty patches for non-existent item', () => {
      const patches = model.changeStatus(999, 'closed');
      expect(patches).toHaveLength(0);
    });

    test('should log status change', () => {
      model.addItem({ line1: 'Task' });
      const itemId = model.items[0].id;
      model.changeStatus(itemId, 'in_progress');
      const log = model.actionLog[model.actionLog.length - 1];
      expect(log.action).toBe('changeStatus');
      expect(log.data.status).toBe('in_progress');
    });
  });

  describe('deleteItem', () => {
    test('should mark item as deleted', () => {
      model.addItem({ line1: 'Task' });
      const itemId = model.items[0].id;
      model.deleteItem(itemId);
      expect(model.items[0].status).toBe('deleted');
    });

    test('should not remove item from array', () => {
      model.addItem({ line1: 'Task' });
      model.deleteItem(model.items[0].id);
      expect(model.items).toHaveLength(1);
    });
  });

  describe('addTag', () => {
    test('should add tag to item', () => {
      model.addItem({ line1: 'Task' });
      const itemId = model.items[0].id;
      const patches = model.addTag(itemId, 'urgent');
      expect(model.items[0].tags).toContain('urgent');
      expect(patches).toHaveLength(1);
    });

    test('should not add duplicate tags', () => {
      model.addItem({ line1: 'Task' });
      const itemId = model.items[0].id;
      model.addTag(itemId, 'urgent');
      model.addTag(itemId, 'urgent');
      expect(model.items[0].tags).toHaveLength(1);
    });
  });

  describe('removeTag', () => {
    test('should remove tag from item', () => {
      model.addItem({ line1: 'Task' });
      const itemId = model.items[0].id;
      model.addTag(itemId, 'urgent');
      model.removeTag(itemId, 'urgent');
      expect(model.items[0].tags).not.toContain('urgent');
    });

    test('should handle removing non-existent tag', () => {
      model.addItem({ line1: 'Task' });
      const itemId = model.items[0].id;
      const patches = model.removeTag(itemId, 'nonexistent');
      expect(patches).toHaveLength(1);
    });
  });

  describe('getVisibleItems', () => {
    test('should hide closed items', () => {
      model.addItem({ line1: 'Open' });
      model.addItem({ line1: 'Closed' });
      model.changeStatus(model.items[1].id, 'closed');
      const visible = model.getVisibleItems();
      expect(visible).toHaveLength(1);
      expect(visible[0].line1).toBe('Open');
    });

    test('should hide deleted items', () => {
      model.addItem({ line1: 'Open' });
      model.addItem({ line1: 'Deleted' });
      model.deleteItem(model.items[1].id);
      const visible = model.getVisibleItems();
      expect(visible).toHaveLength(1);
    });

    test('should show open, in_progress, paused items', () => {
      model.addItem({ line1: 'Open' });
      model.addItem({ line1: 'InProgress' });
      model.addItem({ line1: 'Paused' });
      model.changeStatus(model.items[1].id, 'in_progress');
      model.changeStatus(model.items[2].id, 'paused');
      const visible = model.getVisibleItems();
      expect(visible).toHaveLength(3);
    });
  });

  describe('moveItem', () => {
    test('should change parentId', () => {
      model.addItem({ line1: 'Parent' });
      model.addItem({ line1: 'Child', line2: '' }, null);
      const parentId = model.items[0].id;
      const childId = model.items[1].id;
      const patches = model.moveItem(childId, parentId);
      expect(model.items[1].parentId).toBe(parentId);
      expect(patches).toHaveLength(1);
    });

    test('should return empty patches for non-existent item', () => {
      const patches = model.moveItem(999, 1);
      expect(patches).toHaveLength(0);
    });
  });

  describe('getChildren', () => {
    test('should return children of parent', () => {
      model.addItem({ line1: 'Parent' });
      const parentId = model.items[0].id;
      model.addItem({ line1: 'Child1' }, parentId);
      model.addItem({ line1: 'Child2' }, parentId);
      const children = model.getChildren(parentId);
      expect(children).toHaveLength(2);
    });

    test('should not return closed children', () => {
      model.addItem({ line1: 'Parent' });
      const parentId = model.items[0].id;
      model.addItem({ line1: 'Child1' }, parentId);
      model.addItem({ line1: 'Child2' }, parentId);
      model.changeStatus(model.items[2].id, 'closed');
      const children = model.getChildren(parentId);
      expect(children).toHaveLength(1);
    });
  });
});
