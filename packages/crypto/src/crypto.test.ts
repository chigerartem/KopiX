import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { encrypt, decrypt } from "./crypto.js";

const KEY = randomBytes(32).toString("base64");

describe("crypto: AES-256-GCM encrypt/decrypt", () => {
  it("round-trips a short ASCII string", () => {
    const plaintext = "bingx-api-key-example";
    const ciphertext = encrypt(plaintext, KEY);
    expect(decrypt(ciphertext, KEY)).toBe(plaintext);
  });

  it("round-trips a long unicode string", () => {
    const plaintext = "🔑 секрет api key with spaces & punctuation!";
    const ciphertext = encrypt(plaintext, KEY);
    expect(decrypt(ciphertext, KEY)).toBe(plaintext);
  });

  it("produces different ciphertext for identical plaintext (random IV)", () => {
    const plaintext = "same-input";
    const c1 = encrypt(plaintext, KEY);
    const c2 = encrypt(plaintext, KEY);
    expect(c1).not.toBe(c2);
    expect(decrypt(c1, KEY)).toBe(plaintext);
    expect(decrypt(c2, KEY)).toBe(plaintext);
  });

  it("rejects ciphertext encrypted with a different key (auth tag mismatch)", () => {
    const otherKey = randomBytes(32).toString("base64");
    const ciphertext = encrypt("secret", KEY);
    expect(() => decrypt(ciphertext, otherKey)).toThrow();
  });

  it("rejects tampered ciphertext", () => {
    const ciphertext = encrypt("secret", KEY);
    const buf = Buffer.from(ciphertext, "base64");
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 0xff;
    const tampered = buf.toString("base64");
    expect(() => decrypt(tampered, KEY)).toThrow();
  });

  it("rejects keys that are not exactly 32 bytes", () => {
    const shortKey = randomBytes(16).toString("base64");
    expect(() => encrypt("x", shortKey)).toThrow(/32 bytes/);
    expect(() => decrypt("aaaa", shortKey)).toThrow(/32 bytes/);
  });

  it("rejects ciphertext shorter than IV + auth tag", () => {
    expect(() => decrypt(Buffer.alloc(10).toString("base64"), KEY)).toThrow(/too short/);
  });
});
