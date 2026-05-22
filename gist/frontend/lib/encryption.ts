const DEFAULT_ITERATIONS = 310000;

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

async function derivePasswordKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
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

export type PasswordEncryptedPayload = {
  ciphertext: string;
  iv: string;
  salt: string;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  algorithm: "AES-GCM";
};

export type PasswordEncryptedArtifactRecord = {
  ciphertext: string;
  iv: string;
  salt: string;
  kdf: string;
  iterations: number;
  algorithm: string;
};

export async function encryptStringWithPassword(
  plaintext: string,
  password: string,
): Promise<PasswordEncryptedPayload> {
  if (!crypto.subtle) {
    throw new Error("Browser encryption is not available in this context.");
  }
  if (!password) {
    throw new Error("Password is required.");
  }

  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derivePasswordKey(password, salt, DEFAULT_ITERATIONS);
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

export async function decryptStringWithPassword(
  artifact: PasswordEncryptedArtifactRecord,
  password: string,
): Promise<string> {
  if (!crypto.subtle) {
    throw new Error("Browser encryption is not available in this context.");
  }
  if (!password) {
    throw new Error("Password is required.");
  }
  if (artifact.kdf !== "PBKDF2-SHA256" || artifact.algorithm !== "AES-GCM") {
    throw new Error("Unsupported encrypted save format.");
  }

  const key = await derivePasswordKey(
    password,
    base64ToBytes(artifact.salt),
    artifact.iterations,
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(artifact.iv) as BufferSource },
    key,
    base64ToBytes(artifact.ciphertext) as BufferSource,
  );

  return new TextDecoder().decode(plaintext);
}
