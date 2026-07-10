// Jest setup file - provide globals for test environment

// Mock localStorage for unit tests
global.localStorage = {
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
};

// Mock fetch for sync-adapter tests
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ items: [], version: 0 })
  })
);

// Mock navigator
global.navigator = {
  vibrate: jest.fn()
};

// Mock window
global.window = {
  innerHeight: 800,
  innerWidth: 400,
  scrollBy: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn()
};

// Provide Math.max for tests
if (!global.Math.max) {
  global.Math.max = Math.max;
}
