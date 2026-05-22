const DEFAULT_ITERATIONS = 310000;
const LOCAL_KEY_DB = "gist-private-keys";
const LOCAL_KEY_STORE = "keys";
const LOCAL_SYNTHESIS_KEY_ID = "synthesis-aes-gcm-v1";
const LOCAL_SYNTHESIS_BACKUP_ID = "synthesis-key-backup-v1";

type StoredKeyBackup = {
  encryptedDataKey: string;
  dataKeyIv: string;
  keySalt: string;
  keyKdf: "PBKDF2-SHA256";
  keyIterations: number;
  keyAlgorithm: "AES-GCM";
  keyVersion: string;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function base64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
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
  kdf: "PBKDF2-SHA256" | "BROWSER_LOCAL_AES_GCM" | "DATA_KEY_AES_GCM";
  iterations: number;
  algorithm: "AES-GCM";
};

export type EncryptedArtifactPayload = EncryptedPayload & StoredKeyBackup & {
  recoverySecret: string | null;
};

export type EncryptedArtifactRecord = {
  ciphertext: string;
  iv: string;
  encrypted_data_key: string | null;
  data_key_iv: string | null;
  key_salt: string | null;
  key_kdf: string | null;
  key_iterations: number | null;
  key_algorithm: string | null;
  key_version: string | null;
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

async function loadLocalBackup(): Promise<StoredKeyBackup | null> {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LOCAL_KEY_STORE, "readonly");
    const request = tx.objectStore(LOCAL_KEY_STORE).get(LOCAL_SYNTHESIS_BACKUP_ID);
    request.onsuccess = () => resolve((request.result as StoredKeyBackup) ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function saveLocalBackup(backup: StoredKeyBackup): Promise<void> {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LOCAL_KEY_STORE, "readwrite");
    tx.objectStore(LOCAL_KEY_STORE).put(backup, LOCAL_SYNTHESIS_BACKUP_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getOrCreateLocalAesKey(): Promise<CryptoKey> {
  const existing = await loadLocalKey();
  if (existing?.extractable) return existing;

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  await saveLocalKey(key);
  return key;
}

async function wrapDataKeyForRecovery(
  dataKey: CryptoKey,
): Promise<StoredKeyBackup & { recoverySecret: string }> {
  const recoverySecret = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const keySalt = crypto.getRandomValues(new Uint8Array(16));
  const dataKeyIv = crypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await deriveAesKey(
    recoverySecret,
    keySalt,
    DEFAULT_ITERATIONS,
  );
  const rawDataKey = await crypto.subtle.exportKey("raw", dataKey);
  const encryptedDataKey = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: dataKeyIv as BufferSource },
    wrappingKey,
    rawDataKey,
  );

  return {
    recoverySecret,
    encryptedDataKey: bytesToBase64(new Uint8Array(encryptedDataKey)),
    dataKeyIv: bytesToBase64(dataKeyIv),
    keySalt: bytesToBase64(keySalt),
    keyKdf: "PBKDF2-SHA256",
    keyIterations: DEFAULT_ITERATIONS,
    keyAlgorithm: "AES-GCM",
    keyVersion: "synthesis-data-key-v1",
  };
}

async function getOrCreateRecoveryBackup(
  dataKey: CryptoKey,
): Promise<StoredKeyBackup & { recoverySecret: string | null }> {
  const existing = await loadLocalBackup();
  if (existing) return { ...existing, recoverySecret: null };

  const created = await wrapDataKeyForRecovery(dataKey);
  const { recoverySecret, ...backup } = created;
  await saveLocalBackup(backup);
  return created;
}

async function unwrapDataKeyWithRecoverySecret(
  artifact: EncryptedArtifactRecord,
  recoverySecret: string,
): Promise<CryptoKey> {
  if (
    !artifact.encrypted_data_key ||
    !artifact.data_key_iv ||
    !artifact.key_salt ||
    !artifact.key_iterations
  ) {
    throw new Error("This encrypted save does not include a recovery backup.");
  }

  const wrappingKey = await deriveAesKey(
    recoverySecret.trim(),
    base64ToBytes(artifact.key_salt),
    artifact.key_iterations,
  );
  const rawDataKey = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(artifact.data_key_iv) as BufferSource,
    },
    wrappingKey,
    base64ToBytes(artifact.encrypted_data_key) as BufferSource,
  );
  const dataKey = await crypto.subtle.importKey(
    "raw",
    rawDataKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );

  await saveLocalKey(dataKey);
  await saveLocalBackup({
    encryptedDataKey: artifact.encrypted_data_key,
    dataKeyIv: artifact.data_key_iv,
    keySalt: artifact.key_salt,
    keyKdf: "PBKDF2-SHA256",
    keyIterations: artifact.key_iterations,
    keyAlgorithm: "AES-GCM",
    keyVersion: artifact.key_version ?? "synthesis-data-key-v1",
  });
  return dataKey;
}

async function decryptWithKey(
  artifact: EncryptedArtifactRecord,
  key: CryptoKey,
): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(artifact.iv) as BufferSource },
    key,
    base64ToBytes(artifact.ciphertext) as BufferSource,
  );
  return new TextDecoder().decode(plaintext);
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

export async function encryptStringWithRecoveryBackup(
  plaintext: string,
): Promise<EncryptedArtifactPayload> {
  if (!crypto.subtle || !indexedDB) {
    throw new Error("Browser encryption is not available in this context.");
  }

  const enc = new TextEncoder();
  const key = await getOrCreateLocalAesKey();
  const keyBackup = await getOrCreateRecoveryBackup(key);
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
    kdf: "DATA_KEY_AES_GCM",
    iterations: 0,
    algorithm: "AES-GCM",
    ...keyBackup,
  };
}

export async function decryptStringWithLocalKey(
  artifact: EncryptedArtifactRecord,
): Promise<string> {
  if (!crypto.subtle || !indexedDB) {
    throw new Error("Browser encryption is not available in this context.");
  }

  const key = await loadLocalKey();
  if (!key) {
    throw new Error("This browser does not have the private key yet.");
  }
  return decryptWithKey(artifact, key);
}

export async function decryptStringWithRecoverySecret(
  artifact: EncryptedArtifactRecord,
  recoverySecret: string,
): Promise<string> {
  if (!crypto.subtle || !indexedDB) {
    throw new Error("Browser encryption is not available in this context.");
  }
  const key = await unwrapDataKeyWithRecoverySecret(artifact, recoverySecret);
  return decryptWithKey(artifact, key);
}
