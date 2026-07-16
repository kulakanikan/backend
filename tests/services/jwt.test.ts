import { describe, expect, test } from "bun:test";
import { signJWT, verifyJWT } from "../../src/services/jwt";

describe("JWT Service", () => {
  test("should sign and verify JWT correctly", async () => {
    process.env.JWT_SECRET = "supersecretjwtkeywithatleast32characterslong";
    const payload = {
      sub: "user-uuid-123",
      email: "test@example.com",
      nama: "Test User",
    };

    const token = await signJWT(payload);
    expect(token).toBeDefined();
    expect(typeof token).toBe("string");

    const decoded = await verifyJWT(token);
    expect(decoded.sub).toBe(payload.sub);
    expect(decoded.email).toBe(payload.email);
    expect(decoded.nama).toBe(payload.nama);
  });

  test("should throw error when verify invalid JWT", async () => {
    process.env.JWT_SECRET = "supersecretjwtkeywithatleast32characterslong";
    expect(verifyJWT("invalid-token")).rejects.toThrow();
  });
});
