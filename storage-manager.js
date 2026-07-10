'use strict';

/**
 * StorageManager - offline-first хранилище
 *
 * Приоритет:
 * 1. localStorage (быстро)
 * 2. Локальный файл (fallback)
 * 3. Дефолт (пусто)
 */

class StorageManager {
  constructor(listId, config = {}) {
    this.listId = listId;
    this.stateKey = `list-state-${listId}`;
    this.pendingKey = `list-pending-${listId}`;
    this.logKey = `list-log-${listId}`;
    this.localFilePath = config.localFilePath || './list-data.json';
  }

  /**
   * Загрузить состояние: localStorage → файл → дефолт
   */
  async loadState() {
    // 1️⃣ localStorage
    try {
      const stored = localStorage.getItem(this.stateKey);
      if (stored) {
        console.log('[StorageManager] Loaded from localStorage');
        return JSON.parse(stored);
      }
    } catch (err) {
      console.warn('[StorageManager] localStorage failed:', err);
    }

    // 2️⃣ Fallback на локальный файл
    try {
      const response = await fetch(this.localFilePath);
      if (response.ok) {
        const data = await response.json();
        console.log('[StorageManager] Loaded from local file');
        // Сохранить в localStorage для будущих загрузок
        this.saveState(data);
        return data;
      }
    } catch (err) {
      console.warn('[StorageManager] Local file fallback failed:', err);
    }

    // 3️⃣ Дефолт
    console.log('[StorageManager] Using default empty state');
    return { items: [], version: 0 };
  }

  /**
   * Сохранить состояние в localStorage И файл
   */
  async saveState(state) {
    // localStorage (обязательно)
    try {
      localStorage.setItem(this.stateKey, JSON.stringify(state));
      console.log('[StorageManager] Saved to localStorage');
    } catch (err) {
      console.warn('[StorageManager] Failed to save to localStorage:', err);
    }

    // Локальный файл (опционально)
    try {
      await fetch(this.localFilePath, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state)
      });
      console.log('[StorageManager] Saved to local file');
    } catch (err) {
      console.warn('[StorageManager] Failed to save to file:', err);
      // Это OK - основное хранилище это localStorage
    }
  }

  // ===== ЛОГИРОВАНИЕ ДЕЙСТВИЙ =====

  /**
   * Получить лог действий
   */
  getActionLog() {
    try {
      const stored = localStorage.getItem(this.logKey);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  /**
   * Сохранить лог действий
   */
  saveActionLog(actionLog) {
    try {
      localStorage.setItem(this.logKey, JSON.stringify(actionLog));
      console.log('[StorageManager] Saved action log');
    } catch (err) {
      console.warn('[StorageManager] Failed to save action log:', err);
    }
  }

  /**
   * Очистить лог действий
   */
  clearActionLog() {
    try {
      localStorage.removeItem(this.logKey);
      console.log('[StorageManager] Cleared action log');
    } catch (err) {
      console.warn('[StorageManager] Failed to clear action log:', err);
    }
  }

  // ===== ОЧЕРЕДЬ ПАТЧЕЙ =====

  /**
   * Добавить патчи в очередь
   */
  addPending(patches) {
    try {
      const pending = this.getPending();
      pending.push({
        patches,
        timestamp: Date.now()
      });
      localStorage.setItem(this.pendingKey, JSON.stringify(pending));
      console.log('[StorageManager] Added to pending queue:', patches.length, 'patches');
    } catch (err) {
      console.warn('[StorageManager] Failed to add pending:', err);
    }
  }

  /**
   * Получить очередь (без очистки)
   */
  getPending() {
    try {
      return JSON.parse(localStorage.getItem(this.pendingKey) || '[]');
    } catch {
      return [];
    }
  }

  /**
   * Получить очередь и очистить
   */
  getPendingAndClear() {
    const pending = this.getPending();
    try {
      localStorage.removeItem(this.pendingKey);
      console.log('[StorageManager] Cleared pending queue');
    } catch (err) {
      console.warn('[StorageManager] Failed to clear pending:', err);
    }
    return pending;
  }

  // ===== LWW (Last-Write-Wins) =====

  /**
   * Разрешить конфликт версий
   */
  resolveLWW(serverVersion, localVersion) {
    if (serverVersion > localVersion) {
      return { action: 'accept', reason: 'server-newer' };
    }
    return { action: 'keepLocal', reason: 'local-newer-or-equal' };
  }

  // ===== ОЧИСТКА =====

  /**
   * Очистить всё хранилище
   */
  clear() {
    try {
      localStorage.removeItem(this.stateKey);
      localStorage.removeItem(this.pendingKey);
      localStorage.removeItem(this.logKey);
      console.log('[StorageManager] Cleared all storage');
    } catch (err) {
      console.warn('[StorageManager] Failed to clear storage:', err);
    }
  }
}
