'use strict';

/**
 * EventBus - простой pub-sub для связи между слоями
 *
 * События:
 * - addItem, editItem, changeStatus, moveItem, addTag, removeTag, deleteItem
 * - syncStart, syncSuccess, syncError
 * - actionLogged
 * - visibleItemsChanged
 */

class EventBus {
  constructor() {
    this.listeners = {};
  }

  /**
   * Подписаться на событие
   */
  on(event, handler) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(handler);

    // Вернуть функцию отписки
    return () => this.off(event, handler);
  }

  /**
   * Отписаться от события
   */
  off(event, handler) {
    if (!this.listeners[event]) return;
    const idx = this.listeners[event].indexOf(handler);
    if (idx > -1) {
      this.listeners[event].splice(idx, 1);
    }
  }

  /**
   * Один раз подписаться на событие
   */
  once(event, handler) {
    const unsubscribe = this.on(event, (data) => {
      handler(data);
      unsubscribe();
    });
  }

  /**
   * Выдать событие
   */
  emit(event, data) {
    if (!this.listeners[event]) return;
    this.listeners[event].forEach(handler => {
      try {
        handler(data);
      } catch (err) {
        console.error(`Error in event listener for ${event}:`, err);
      }
    });
  }

  /**
   * Выдать событие асинхронно
   */
  async emitAsync(event, data) {
    if (!this.listeners[event]) return;
    for (const handler of this.listeners[event]) {
      try {
        await handler(data);
      } catch (err) {
        console.error(`Error in async event listener for ${event}:`, err);
      }
    }
  }

  /**
   * Очистить всех слушателей
   */
  clear(event) {
    if (event) {
      this.listeners[event] = [];
    } else {
      this.listeners = {};
    }
  }
}
