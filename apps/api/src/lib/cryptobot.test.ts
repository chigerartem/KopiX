import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { verifyWebhookSignature } from "./cryptobot.js";

const TOKEN = "12345:AAA-cryptobot-test-token";

function sign(body: string, token: string): string {
  const secret = createHash("sha256").update(token).digest();
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyWebhookSignature: CryptoBot webhook HMAC", () => {
  const savedToken = process.env["CRYPTOBOT_API_TOKEN"];

  beforeEach(() => {
    process.env["CRYPTOBOT_API_TOKEN"] = TOKEN;
  });

  afterEach(() => {
    if (savedToken === undefined) delete process.env["CRYPTOBOT_API_TOKEN"];
    else process.env["CRYPTOBOT_API_TOKEN"] = savedToken;
  });

  it("accepts a correctly signed body", () => {
    const body = JSON.stringify({ update_id: 1, update_type: "invoice_paid", payload: {} });
    expect(verifyWebhookSignature(body, sign(body, TOKEN))).toBe(true);
  });

  it("rejects when the body is modified after signing", () => {
    const body = JSON.stringify({ update_id: 1 });
    const sig = sign(body, TOKEN);
    const tampered = JSON.stringify({ update_id: 2 });
    expect(verifyWebhookSignature(tampered, sig)).toBe(false);
  });

  it("rejects a signature produced with a different token", () => {
    const body = JSON.stringify({ update_id: 1 });
    const sig = sign(body, "other-token");
    expect(verifyWebhookSignature(body, sig)).toBe(false);
  });

  it("rejects a signature of wrong length", () => {
    const body = JSON.stringify({ update_id: 1 });
    expect(verifyWebhookSignature(body, "deadbeef")).toBe(false);
  });

  it("rejects a non-hex signature without throwing", () => {
    const body = JSON.stringify({ update_id: 1 });
    expect(verifyWebhookSignature(body, "zzzz!!!!not-hex")).toBe(false);
  });

  it("returns false when token env var is unset", () => {
    delete process.env["CRYPTOBOT_API_TOKEN"];
    const body = JSON.stringify({ update_id: 1 });
    expect(verifyWebhookSignature(body, sign(body, TOKEN))).toBe(false);
  });
});
