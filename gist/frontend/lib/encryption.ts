const DEFAULT_ITERATIONS = 310000;
const LOCAL_KEY_DB = "gist-private-keys";
const LOCAL_KEY_STORE = "keys";
const LOCAL_SYNTHESIS_KEY_ID = "synthesis-aes-gcm-v1";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function deriveAesKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export type EncryptedPayload = {
  ciphertext: string;
  iv: string;
  salt: string;
  kdf: "PBKDF2-SHA256" | "BROWSER_LOCAL_AES_GCM";
  iterations: number;
  algorithm: "AES-GCM";
};

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_KEY_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(LOCAL_KEY_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadLocalKey(): Promise<CryptoKey | null> {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LOCAL_KEY_STORE, "readonly");
    const request = tx.objectStore(LOCAL_KEY_STORE).get(LOCAL_SYNTHESIS_KEY_ID);
    request.onsuccess = () => resolve((request.result as CryptoKey) ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function saveLocalKey(key: CryptoKey): Promise<void> {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LOCAL_KEY_STORE, "readwrite");
    tx.objectStore(LOCAL_KEY_STORE).put(key, LOCAL_SYNTHESIS_KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getOrCreateLocalAesKey(): Promise<CryptoKey> {
  const existing = await loadLocalKey();
  if (existing) return existing;

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  await saveLocalKey(key);
  return key;
}

export async function encryptString(
  plaintext: string,
  passphrase: string,
): Promise<EncryptedPayload> {
  if (!crypto.subtle) {
    throw new Error("Browser encryption is not available in this context.");
  }

  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(passphrase, salt, DEFAULT_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    enc.encode(plaintext),
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
    kdf: "PBKDF2-SHA256",
    iterations: DEFAULT_ITERATIONS,
    algorithm: "AES-GCM",
  };
}

export async function encryptStringWithLocalKey(
  plaintext: string,
): Promise<EncryptedPayload> {
  if (!crypto.subtle || !indexedDB) {
    throw new Error("Browser encryption is not available in this context.");
  }

  const enc = new TextEncoder();
  const key = await getOrCreateLocalAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    enc.encode(plaintext),
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
    salt: LOCAL_SYNTHESIS_KEY_ID,
    kdf: "BROWSER_LOCAL_AES_GCM",
    iterations: 0,
    algorithm: "AES-GCM",
  };
}
