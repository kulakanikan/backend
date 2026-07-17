import { describe, it, expect, mock, beforeAll, beforeEach } from "bun:test";
import { signJWT } from "../../src/services/jwt";

// Mock global registry handler jika belum terdaftar
mock.module("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {
        generateContent: async () => {
          if ((globalThis as any).mockGeminiGenerateContent) {
            return (globalThis as any).mockGeminiGenerateContent();
          }
          throw new Error("mockGeminiGenerateContent is not defined");
        }
      };
    }
  },
}));

process.env.GEMINI_API_KEY = "test-key";

const { app } = await import("../../src/index");

let AUTH_HEADER: { Authorization: string };

describe("POST /api/voice/parse", () => {
  const defaultResponse = {
    jenis_ikan: "lele",
    berat: 30,
    harga_beli_per_kg: 18000,
    kondisi_kualitas: "segar",
    nama_supplier: "Pak Amin",
    catatan: null,
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = "supersecretjwtkeywithatleast32characterslong";
    const token = await signJWT({ sub: "test-user-id", email: "test@example.com", nama: "Test User" });
    AUTH_HEADER = { Authorization: `Bearer ${token}` };
  });

  beforeEach(() => {
    (globalThis as any).mockGeminiGenerateContent = async () => ({
      response: {
        text: () => JSON.stringify(defaultResponse),
      },
    });
  });

  it("returns batch suggestion for batch form_type", async () => {
    const res = await app.request("/api/voice/parse", {
      method: "POST",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript: "Beli lele 30 kilo dari Pak Amin 18 ribu segar",
        form_type: "batch",
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.form_type).toBe("batch");
    expect(json.data.suggestion).toMatchObject({
      jenis_ikan: "lele",
      berat: 30,
    });
  });

  it("returns 400 for empty/too short transcript", async () => {
    const res = await app.request("/api/voice/parse", {
      method: "POST",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: "ab", form_type: "batch" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid form_type", async () => {
    const res = await app.request("/api/voice/parse", {
      method: "POST",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript: "Beli lele 30 kilo",
        form_type: "invalid_form",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 401 without auth token", async () => {
    const res = await app.request("/api/voice/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: "test", form_type: "batch" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns graceful fallback (nulls) even when Gemini fails", async () => {
    // Override mock untuk fail secara lokal untuk test case ini
    (globalThis as any).mockGeminiGenerateContent = async () => {
      throw new Error("Gemini API down");
    };

    const res = await app.request("/api/voice/parse", {
      method: "POST",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: "Beli lele 30 kilo", form_type: "batch" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.suggestion.jenis_ikan).toBeNull();
    expect(json.data.suggestion.berat).toBeNull();
  });
});
