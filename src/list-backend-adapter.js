export function createBackendAdapter() {
  return {
    async load() {
      return null;
    },
    async save(state) {
      return state;
    }
  };
}
