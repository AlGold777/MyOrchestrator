((global) => {
  if (global.ApiKeyStorage) return;

  const SESSION_PREFIX = '__api_session__';
  const ENCRYPTED_PREFIX = '__api_enc__';
  const LEGACY_WARNING_FLAG = '__api_plaintext_warned__';
  const PASS_PHRASE_SALT = new TextEncoder().encode('llm-codex-apikey-salt-2026');
  const SESSION_STORE = chrome?.storage?.session || null;

  const apiKeyStore = {
    async setSessionKey(storageKey, value) {
      if (!storageKey) return;
      const targetKey = `${SESSION_PREFIX}${storageKey}`;
      const store = SESSION_STORE || chrome.storage.local;
      if (!value) {
        await storageRemove(store, targetKey);
        return;
      }
      await storageSet(store, targetKey, value);
    },

    async getSessionKey(storageKey) {
      if (!storageKey) return null;
      const targetKey = `${SESSION_PREFIX}${storageKey}`;
      const store = SESSION_STORE || chrome.storage.local;
      const result = await storageGet(store, targetKey);
      return result ?? null;
    },

    async clearSessionKey(storageKey) {
      if (!storageKey) return;
      const targetKey = `${SESSION_PREFIX}${storageKey}`;
      const store = SESSION_STORE || chrome.storage.local;
      await storageRemove(store, targetKey);
    },

    async getLegacyKey(storageKey) {
      if (!storageKey) return null;
      return storageGet(chrome.storage.local, storageKey);
    },

    async clearLegacyKey(storageKey) {
      if (!storageKey) return;
      await storageRemove(chrome.storage.local, storageKey);
    },

    async setWithPassphrase(storageKey, value, passphrase) {
      if (!storageKey || !value || !passphrase) return;
      const encrypted = await encryptWithPassphrase(passphrase, value);
      if (!encrypted) return;
      await storageSet(chrome.storage.local, `${ENCRYPTED_PREFIX}${storageKey}`, encrypted);
    },

    async getWithPassphrase(storageKey, passphrase) {
      if (!storageKey || !passphrase) return null;
      const encrypted = await storageGet(chrome.storage.local, `${ENCRYPTED_PREFIX}${storageKey}`);
      if (!encrypted) return null;
      return decryptWithPassphrase(passphrase, encrypted);
    },

    warnPlaintext(storageKey) {
      if (!storageKey) return;
      const flagKey = `${LEGACY_WARNING_FLAG}_${storageKey}`;
      storageGet(chrome.storage.local, flagKey).then((warned) => {
        if (warned) return;
        console.warn(`[ApiKeyStorage] Plain text key "${storageKey}" present in chrome.storage.local. Consider re-saving into session storage or use passphrase encryption.`);
        storageSet(chrome.storage.local, flagKey, true);
      }).catch(() => {});
    }
  };

  function storageGet(store, key) {
    return new Promise((resolve) => {
      if (!store || !key) {
        resolve(null);
        return;
      }
      store.get([key], (res) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(res?.[key] ?? null);
      });
    });
  }

  function storageSet(store, key, value) {
    return new Promise((resolve, reject) => {
      if (!store || !key) {
        reject(new Error('Invalid storage target'));
        return;
      }
      store.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  function storageRemove(store, key) {
    return new Promise((resolve) => {
      if (!store || !key) {
        resolve();
        return;
      }
      store.remove([key], () => {
        resolve();
      });
    });
  }

  async function deriveCryptoKey(passphrase) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: PASS_PHRASE_SALT,
        iterations: 100_000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptWithPassphrase(passphrase, value) {
    try {
      const key = await deriveCryptoKey(passphrase);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoder = new TextEncoder();
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(value));
      const combined = new Uint8Array(iv.length + encrypted.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(encrypted), iv.length);
      return btoa(String.fromCharCode(...combined));
    } catch (err) {
      console.warn('[ApiKeyStorage] Encryption failed', err);
      return null;
    }
  }

  async function decryptWithPassphrase(passphrase, payload) {
    try {
      const key = await deriveCryptoKey(passphrase);
      const raw = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
      const iv = raw.slice(0, 12);
      const data = raw.slice(12);
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
      const decoder = new TextDecoder();
      return decoder.decode(decrypted);
    } catch (err) {
      console.warn('[ApiKeyStorage] Decryption failed', err);
      return null;
    }
  }

  global.ApiKeyStorage = Object.freeze(apiKeyStore);
})(typeof self !== 'undefined' ? self : this);
