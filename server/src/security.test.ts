import assert from "node:assert/strict";
import test from "node:test";
import { decryptSecret, encryptSecret, hashPassword, verifyPassword } from "./security";

const encryptionKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

test("encrypts and decrypts refresh tokens", () => {
  const encrypted = encryptSecret("refresh-token-value", encryptionKey);
  assert.notEqual(encrypted.ciphertext, "refresh-token-value");
  assert.equal(decryptSecret(encrypted, encryptionKey), "refresh-token-value");
});

test("hashes and verifies admin passwords", async () => {
  const hash = await hashPassword("a-long-admin-password");
  assert.equal(await verifyPassword("a-long-admin-password", hash), true);
  assert.equal(await verifyPassword("wrong-admin-password", hash), false);
});
