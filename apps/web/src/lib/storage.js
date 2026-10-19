// a browser that refuses storage throws on access, on reads, and on writes, so a refused read counts as nothing
// saved and a refused write is dropped
const backing = (kind) =>
  kind === "session" ? globalThis.sessionStorage : globalThis.localStorage;

export const read = (kind, key) => {
  try {
    const store = backing(kind);
    return store ? store.getItem(key) : null;
  } catch {
    return null;
  }
};

export const write = (kind, key, value) => {
  try {
    const store = backing(kind);
    if (!store) {
      return false;
    }
    store.setItem(key, String(value));
    return true;
  } catch {
    return false;
  }
};

export const remove = (kind, key) => {
  try {
    const store = backing(kind);
    if (!store) {
      return false;
    }
    store.removeItem(key);
    return true;
  } catch {
    return false;
  }
};

// for modules that take a Storage like object
export const storageAdapter = (kind) => ({
  getItem: (key) => read(kind, key),
  setItem: (key, value) => {
    write(kind, key, value);
  },
});
