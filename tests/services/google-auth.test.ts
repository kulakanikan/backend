import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { verifyGoogleToken } from "../../src/services/google-auth";

describe("Google Token Verification Service", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("should parse and return userInfo for valid token info", async () => {
    const mockUser = {
      sub: "google-sub-123",
      email: "user@example.com",
      name: "Google User",
      picture: "https://avatar.url",
      aud: "test-client-id",
      exp: Math.floor((Date.now() + 100000) / 1000).toString(),
    };

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(mockUser), { status: 200 }))
    ) as any;

    const result = await verifyGoogleToken("valid-id-token");
    expect(result.sub).toBe(mockUser.sub);
    expect(result.email).toBe(mockUser.email);
    expect(result.name).toBe(mockUser.name);
    expect(result.picture).toBe(mockUser.picture);
  });

  test("should parse and return userInfo for valid token info with mobile azp audience", async () => {
    const mockUser = {
      sub: "google-sub-456",
      email: "mobile@example.com",
      name: "Mobile User",
      picture: "",
      aud: "accounts.google.com",
      azp: "test-client-id",
      exp: Math.floor((Date.now() + 100000) / 1000).toString(),
    };

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(mockUser), { status: 200 }))
    ) as any;

    const result = await verifyGoogleToken("valid-id-token");
    expect(result.sub).toBe(mockUser.sub);
    expect(result.email).toBe(mockUser.email);
  });

  test("should throw error if fetch failed", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 400 }))
    ) as any;

    expect(verifyGoogleToken("invalid-token")).rejects.toThrow("Failed to verify Google token");
  });

  test("should throw error if audience mismatch", async () => {
    const mockUser = {
      sub: "google-sub-123",
      email: "user@example.com",
      name: "Google User",
      aud: "different-client-id",
      exp: Math.floor((Date.now() + 100000) / 1000).toString(),
    };

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(mockUser), { status: 200 }))
    ) as any;

    expect(verifyGoogleToken("token")).rejects.toThrow("Token audience mismatch");
  });

  test("should throw error if token is expired", async () => {
    const mockUser = {
      sub: "google-sub-123",
      email: "user@example.com",
      name: "Google User",
      aud: "test-client-id",
      exp: Math.floor((Date.now() - 100000) / 1000).toString(), // expired in past
    };

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(mockUser), { status: 200 }))
    ) as any;

    expect(verifyGoogleToken("token")).rejects.toThrow("Google token sudah expired");
  });
});
