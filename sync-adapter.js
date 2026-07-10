'use strict';

/**
 * SyncAdapter - абстрактный класс для синхронизации с бэкендом
 *
 * Реализуйте методы fetchInitialState и sendPatches для вашего бэкенда
 */

class SyncAdapter {
  constructor(config = {}) {
    this.endpoint = config.endpoint || '';
    this.listId = config.listId || 'default';
    this.userId = config.userId || 'anonymous';
    this.timeout = config.timeout || 10000;
  }

  /**
   * Загрузить начальное состояние с бэкенда
   *
   * @returns Promise<{ items: [], version: number }>
   */
  async fetchInitialState() {
    throw new Error('fetchInitialState() must be implemented by subclass');
  }

  /**
   * Отправить патчи на бэкенд
   *
   * @param {Array} patches - JSON Patch операции
   * @param {number} clientVersion - версия клиента
   * @returns Promise<{ serverVersion: number, serverState: { items: [] } }>
   */
  async sendPatches(patches, clientVersion) {
    throw new Error('sendPatches() must be implemented by subclass');
  }

  /**
   * Проверить, доступен ли бэкенд
   */
  async isOnline() {
    if (!this.endpoint) return false;

    try {
      const response = await Promise.race([
        fetch(this.endpoint, { method: 'HEAD' }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), this.timeout)
        )
      ]);
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * RESTAdapter - реализация для REST API бэкенда
 *
 * Ожидает от сервера:
 * GET /api/lists/{listId}
 *   → { items: [], version: number }
 *
 * POST /api/lists/{listId}/sync
 *   ← { patches: [], clientVersion: number }
 *   → { serverVersion: number, serverState: { items: [] } }
 */

class RESTAdapter extends SyncAdapter {
  async fetchInitialState() {
    if (!this.endpoint) {
      throw new Error('Endpoint not configured for RESTAdapter');
    }

    const response = await fetch(`${this.endpoint}/lists/${this.listId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-User-ID': this.userId
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch initial state: ${response.statusText}`);
    }

    return response.json();
  }

  async sendPatches(patches, clientVersion) {
    if (!this.endpoint) {
      throw new Error('Endpoint not configured for RESTAdapter');
    }

    const response = await fetch(`${this.endpoint}/lists/${this.listId}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-ID': this.userId
      },
      body: JSON.stringify({
        patches,
        clientVersion,
        timestamp: Date.now()
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to send patches: ${response.statusText}`);
    }

    return response.json();
  }
}

/**
 * MockAdapter - имитация для локального тестирования
 */

class MockAdapter extends SyncAdapter {
  constructor(config = {}) {
    super(config);
    this.storage = config.storage || {};
    this.delay = config.delay || 500;
  }

  async fetchInitialState() {
    await this.delay_(this.delay);

    if (!this.storage[this.listId]) {
      this.storage[this.listId] = { items: [], version: 0 };
    }

    return JSON.parse(JSON.stringify(this.storage[this.listId]));
  }

  async sendPatches(patches, clientVersion) {
    await this.delay_(this.delay);

    if (!this.storage[this.listId]) {
      this.storage[this.listId] = { items: [], version: 0 };
    }

    const state = this.storage[this.listId];
    state.version = clientVersion + 1;

    return {
      success: true,
      serverVersion: state.version,
      serverState: JSON.parse(JSON.stringify(state))
    };
  }

  async delay_(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * OfflineAdapter - для работы только оффлайн (без синхронизации)
 */

class OfflineAdapter extends SyncAdapter {
  async fetchInitialState() {
    return { items: [], version: 0 };
  }

  async sendPatches(patches, clientVersion) {
    return {
      success: true,
      serverVersion: clientVersion,
      serverState: { items: [] }
    };
  }
}
