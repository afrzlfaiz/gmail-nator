import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { EncryptedSecret } from "./types";

const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_COST = 16_384;
const PASSWORD_BLOCK_SIZE = 8;
const PASSWORD_PARALLELIZATION = 1;

function deriveKey(password: string, salt: Buffer, keyLength: number, options: { N: number; r: number; p: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey as Buffer);
    });
  });
}

function encryptionKey(value: string) {
  const trimmed = value.trim();
  const key = /^[a-f0-9]{64}$/i.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
  if (key.length !== 32) {
    throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return key;
}

export async function hashPassword(password: string) {
  if (!password || password.length < 12) {
    throw new Error("Admin password must contain at least 12 characters");
  }

  const salt = randomBytes(16);
  const derivedKey = await deriveKey(password, salt, PASSWORD_KEY_LENGTH, {
    N: PASSWORD_COST,
    r: PASSWORD_BLOCK_SIZE,
    p: PASSWORD_PARALLELIZATION,
  });
  return `scrypt$${PASSWORD_COST}$${PASSWORD_BLOCK_SIZE}$${PASSWORD_PARALLELIZATION}$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, encodedHash: string) {
  const [, cost, blockSize, parallelization, saltHex, keyHex] = encodedHash.split("$");
  if (!cost || !blockSize || !parallelization || !saltHex || !keyHex) {
    return false;
  }

  try {
    const expected = Buffer.from(keyHex, "hex");
    const actual = await deriveKey(password, Buffer.from(saltHex, "hex"), expected.length, {
      N: Number(cost),
      r: Number(blockSize),
      p: Number(parallelization),
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function encryptSecret(value: string, configuredKey: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(configuredKey), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  };
}

export function decryptSecret(secret: EncryptedSecret, configuredKey: string) {
  const iv = Buffer.from(secret.iv, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(configuredKey), iv);
  decipher.setAuthTag(Buffer.from(secret.tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
