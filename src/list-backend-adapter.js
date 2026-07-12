const firebaseConfig = {
  apiKey: 'AIzaSyBtttOmje8yQvU1mf1-zDbOq5OlBHLt6Ic',
  projectId: 'ai-labg'
};

const defaultTarget = {
  collection: 'lists',
  id: 'main'
};

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildDocumentUrl(target = defaultTarget) {
  const path = `projects/${firebaseConfig.projectId}/databases/(default)/documents/${target.collection}/${target.id}`;
  return `https://firestore.googleapis.com/v1/${path}?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
}

function extractState(snapshotData) {
  if (!snapshotData || typeof snapshotData !== 'object') return null;
  if (snapshotData.snapshot?.items && Array.isArray(snapshotData.actionLog)) return snapshotData;
  return null;
}

function encodeDocument(state, target = defaultTarget) {
  return {
    fields: {
      payload: {
        stringValue: JSON.stringify({
          snapshot: state.snapshot,
          actionLog: state.actionLog
        })
      },
      target: {
        stringValue: `${target.collection}/${target.id}`
      },
      updatedAtMs: {
        integerValue: String(Date.now())
      }
    }
  };
}

function decodeDocument(documentData) {
  const payload = documentData?.fields?.payload?.stringValue;
  if (!payload) return null;

  try {
    return extractState(JSON.parse(payload));
  } catch (error) {
    console.warn('Firestore payload parse skipped', error);
    return null;
  }
}

export function createBackendAdapter({ target = defaultTarget } = {}) {
  return {
    async load() {
      try {
        const response = await fetchWithTimeout(buildDocumentUrl(target), { method: 'GET' }, 1500);
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`Firestore load failed: ${response.status}`);
        return decodeDocument(await response.json());
      } catch (error) {
        console.warn('Firestore load skipped', error);
        return null;
      }
    },

    async save(state) {
      const response = await fetchWithTimeout(
        buildDocumentUrl(target),
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(encodeDocument(state, target))
        },
        4000
      );

      if (!response.ok) {
        throw new Error(`Firestore save failed: ${response.status}`);
      }

      return state;
    }
  };
}
