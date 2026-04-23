import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { validateInitData } from "./auth.js";

const BOT_TOKEN = "123456:TEST_BOT_TOKEN_FOR_UNIT_TESTS";

function signInitData(params: Record<string, string>, token: string): string {
  const dataCheckString = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  const sp = new URLSearchParams(params);
  sp.set("hash", hash);
  return sp.toString();
}

function freshInitData(overrides: Record<string, string> = {}): string {
  const params: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "AAABBBCCC",
    user: JSON.stringify({ id: 42, first_name: "Ada", username: "ada" }),
    ...overrides,
  };
  return signInitData(params, BOT_TOKEN);
}

describe("validateInitData: Telegram Mini App auth", () => {
  it("accepts a valid initData and returns the parsed user", () => {
    const initData = freshInitData();
    const user = validateInitData(initData, BOT_TOKEN);
    expect(user.id).toBe(42);
    expect(user.username).toBe("ada");
  });

  it("rejects initData with no hash field", () => {
    const sp = new URLSearchParams();
    sp.set("auth_date", String(Math.floor(Date.now() / 1000)));
    sp.set("user", JSON.stringify({ id: 1 }));
    expect(() => validateInitData(sp.toString(), BOT_TOKEN)).toThrow(/hash/i);
  });

  it("rejects initData signed with a different bot token", () => {
    const initData = freshInitData();
    expect(() => validateInitData(initData, "999999:OTHER_TOKEN")).toThrow(/Invalid hash/);
  });

  it("rejects initData with a tampered data-check field", () => {
    const initData = freshInitData();
    // Flip user field without re-signing → hash no longer matches
    const sp = new URLSearchParams(initData);
    sp.set("user", JSON.stringify({ id: 9999, first_name: "Mallory" }));
    expect(() => validateInitData(sp.toString(), BOT_TOKEN)).toThrow(/Invalid hash/);
  });

  it("rejects expired initData (auth_date older than 5 minutes) — replay defense", () => {
    const oldAuthDate = String(Math.floor(Date.now() / 1000) - 400);
    const initData = signInitData(
      {
        auth_date: oldAuthDate,
        user: JSON.stringify({ id: 1 }),
      },
      BOT_TOKEN,
    );
    expect(() => validateInitData(initData, BOT_TOKEN)).toThrow(/expired/);
  });

  it("rejects initData missing the user field", () => {
    const initData = signInitData(
      { auth_date: String(Math.floor(Date.now() / 1000)) },
      BOT_TOKEN,
    );
    expect(() => validateInitData(initData, BOT_TOKEN)).toThrow(/Missing user/);
  });

  it("rejects initData with hash of wrong length", () => {
    const sp = new URLSearchParams();
    sp.set("auth_date", String(Math.floor(Date.now() / 1000)));
    sp.set("user", JSON.stringify({ id: 1 }));
    sp.set("hash", "deadbeef");
    expect(() => validateInitData(sp.toString(), BOT_TOKEN)).toThrow(/Invalid hash/);
  });
});
