import { describe, expect, test } from 'vitest';
import { createRenderer } from '../../src/list-renderer.js';

describe('list renderer', () => {
  test('renders nested rows from flat items and shows status badge', () => {
    document.body.innerHTML = `
      <div id="list-container"></div>
      <div id="action-log-panel"></div>
    `;

    const renderer = createRenderer({
      container: document.getElementById('list-container'),
      actionLogPanel: document.getElementById('action-log-panel')
    });

    renderer.render({
      snapshot: {
        items: [
          { id: 'root1', parentId: null, order: 10, status: 'Open', line1: 'Root', line2: '', tags: [], collapsed: false },
          { id: 'child', parentId: 'root1', order: 10, status: 'Focus', line1: 'Child', line2: '', tags: [], collapsed: false }
        ]
      },
      actionLog: []
    });

    expect(document.querySelectorAll('.list-item-wrapper')).toHaveLength(2);
    expect(document.body.textContent).toContain('Focus');
  });
});
