export function createSync({ adapter, onStateChange, store }) {
  let queue = Promise.resolve();

  function enqueue(state, actionLogEntry) {
    if (!actionLogEntry) return queue;

    queue = queue.then(async () => {
      try {
        await adapter.save(state);
        const nextState = store.updateActionLogStatus(actionLogEntry.id, 'synced');
        onStateChange(nextState);
      } catch (error) {
        const nextState = store.updateActionLogStatus(actionLogEntry.id, 'failed');
        onStateChange(nextState);
      }
    });

    return queue;
  }

  return { enqueue };
}
