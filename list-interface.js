'use strict';

/**
 * ListInterface - главный контроллер
 * Связывает: StorageManager, TreeModel, EventBus, SyncAdapter
 * Работает offline-first: localStorage → файл fallback → синхронизация в фоне
 */

class ListInterface {
  constructor(config = {}) {
    this.listId = config.listId || 'default-list';
    this.model = new TreeModel(config.initialItems || []);
    this.adapter = config.syncAdapter || new OfflineAdapter();
    this.storage = new StorageManager(this.listId, config.storage || {});
    this.bus = new EventBus();

    this.syncing = false;
    this.pendingPatches = [];
    this.syncInterval = null;
    this.config = config;
  }

  /**
   * Инициализировать: загрузить состояние, запустить фоновую синхронизацию
   */
  async init() {
    try {
      // 1️⃣ Загрузить состояние (offline-first: localStorage → файл → дефолт)
      const localState = await this.storage.loadState();

      if (localState.items && localState.items.length > 0) {
        this.model.items = localState.items;
        this.model.version = localState.version || 0;
      } else if (this.config.initialItems && this.config.initialItems.length > 0) {
        // Ни localStorage, ни файл не дали данных — использовать начальные данные
        this.model.items = this.config.initialItems;
        this.model.version = 0;
        this.storage.saveState({ items: this.model.items, version: this.model.version });
      } else {
        this.model.items = [];
        this.model.version = localState.version || 0;
      }

      // Восстановить лог действий
      const savedActionLog = this.storage.getActionLog();
      this.model.actionLog = savedActionLog || [];

      this.bus.emit('initialized', { items: this.model.items, version: this.model.version });
      console.log('[ListInterface] Initialized with', this.model.items.length, 'items');

      // 2️⃣ Запустить фоновую синхронизацию
      this.startBackgroundSync();
    } catch (error) {
      console.error('[ListInterface] Initialization failed:', error);
      this.bus.emit('error', error);
    }
  }

  /**
   * Запустить периодическую фоновую синхронизацию
   */
  startBackgroundSync() {
    // Синхронизировать сразу
    this.backgroundSync();

    // Затем каждые 5 секунд
    this.syncInterval = setInterval(() => {
      this.backgroundSync();
    }, 5000);
  }

  /**
   * Остановить фоновую синхронизацию
   */
  stopBackgroundSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  /**
   * Пользователь совершил действие (optimistic update)
   */
  onUserAction(actionType, data) {
    if (typeof this.model[actionType] !== 'function') {
      console.error(`[ListInterface] Unknown action: ${actionType}`);
      return [];
    }

    // 1️⃣ Применить локально сразу (optimistic update)
    const patches = this.model[actionType](data);

    // 2️⃣ Выдать событие для UI
    this.bus.emit(actionType, data);

    // 3️⃣ Сохранить состояние в localStorage
    this.storage.saveState({
      items: this.model.items,
      version: this.model.version
    });

    // 4️⃣ Сохранить лог действий
    this.storage.saveActionLog(this.model.actionLog);

    // 5️⃣ Добавить патчи в очередь (для синхронизации)
    if (patches.length > 0) {
      this.pendingPatches.push(...patches);
      this.storage.addPending(patches);
    }

    // 6️⃣ Эмитить событие логирования
    this.bus.emit('actionLogged', this.model.getActionLog());

    // 7️⃣ Синхронизировать в фоне
    this.backgroundSync();

    return patches;
  }

  /**
   * Фоновая синхронизация (non-blocking)
   */
  async backgroundSync() {
    // Избежать параллельных попыток
    if (this.syncing) return;

    this.syncing = true;
    this.bus.emit('syncStart');

    try {
      // Получить очередь неотправленных патчей
      const pending = this.storage.getPendingAndClear();

      if (pending.length === 0) {
        // Нет неотправленных патчей
        // Просто проверить, доступен ли бэкенд и получить актуальное состояние
        const isOnline = await this.adapter.isOnline();
        if (isOnline) {
          try {
            const serverState = await this.adapter.fetchInitialState();
            // Разрешить конфликт с помощью LWW
            const resolution = this.storage.resolveLWW(serverState.version, this.model.version);
            if (resolution.action === 'accept') {
              this.model.items = serverState.items;
              this.model.version = serverState.version;
              this.storage.saveState({
                items: this.model.items,
                version: this.model.version
              });
              this.bus.emit('visibleItemsChanged', this.model.getVisibleItems());
            }
          } catch (err) {
            console.warn('[ListInterface] Failed to fetch initial state:', err);
          }
        }
      } else {
        // Отправить накопленные патчи
        const allPatches = pending.flatMap(p => p.patches);
        try {
          const result = await this.adapter.sendPatches(allPatches, this.model.version);

          // Разрешить конфликт версий (LWW)
          const resolution = this.storage.resolveLWW(result.serverVersion, this.model.version);
          if (resolution.action === 'accept') {
            this.model.items = result.serverState.items;
            this.model.version = result.serverVersion;
            this.storage.saveState({
              items: this.model.items,
              version: this.model.version
            });
            this.bus.emit('visibleItemsChanged', this.model.getVisibleItems());
            console.log('[ListInterface] Synced successfully, version:', result.serverVersion);
          } else {
            // Локальная версия актуальнее
            console.log('[ListInterface] Kept local version:', this.model.version);
          }

          this.pendingPatches = [];
        } catch (err) {
          // Нет интернета или ошибка сервера - восстановить очередь
          console.warn('[ListInterface] Failed to send patches:', err);
          if (pending.length > 0) {
            this.storage.addPending(pending.flatMap(p => p.patches));
          }
          this.pendingPatches = pending.flatMap(p => p.patches);
          this.bus.emit('syncError', err);
        }
      }

      this.bus.emit('syncSuccess');
    } catch (error) {
      console.error('[ListInterface] Background sync error:', error);
      this.bus.emit('syncError', error);
    } finally {
      this.syncing = false;
    }
  }

  /**
   * Получить видимые элементы (исключить closed и deleted)
   */
  getVisibleItems() {
    return this.model.getVisibleItems();
  }

  /**
   * Получить все элементы
   */
  getAllItems() {
    return this.model.getAllItems();
  }

  /**
   * Получить детей элемента
   */
  getChildren(parentId) {
    return this.model.getChildren(parentId);
  }

  /**
   * Получить лог действий
   */
  getActionLog() {
    return this.model.getActionLog();
  }

  /**
   * Очистить хранилище
   */
  clear() {
    this.model.items = [];
    this.model.version = 0;
    this.model.actionLog = [];
    this.pendingPatches = [];
    this.storage.clear();
    this.bus.emit('visibleItemsChanged', []);
  }

  /**
   * Получить состояние синхронизации
   */
  isSyncing() {
    return this.syncing;
  }

  /**
   * Получить версию модели
   */
  getVersion() {
    return this.model.version;
  }
}
