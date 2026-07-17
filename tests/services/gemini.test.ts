import { describe, it, expect, mock, beforeEach } from "bun:test";

// Register mock module global sekali
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

// Set env sebelum import service
process.env.GEMINI_API_KEY = "test-key";

const { parseVoiceTranscript } = await import("../../src/services/gemini");

describe("parseVoiceTranscript", () => {
  const defaultResponse = {
    jenis_ikan: "tongkol",
    berat: 50,
    harga_beli_per_kg: 25000,
    kondisi_kualitas: "segar",
    nama_supplier: "Pak Budi",
    catatan: null,
  };

  beforeEach(() => {
    (globalThis as any).mockGeminiGenerateContent = async () => ({
      response: {
        text: () => JSON.stringify(defaultResponse),
      },
    });
  });

  describe("batch form_type", () => {
    it("extracts valid batch fields from transcript", async () => {
      const result = await parseVoiceTranscript(
        "Beli tongkol 50 kilo dari Pak Budi, 25 ribu per kilo, segar",
        "batch"
      );
      expect(result).toMatchObject({
        jenis_ikan: "tongkol",
        berat: 50,
        harga_beli_per_kg: 25000,
        kondisi_kualitas: "segar",
        nama_supplier: "Pak Budi",
      });
    });

    it("returns empty suggestion when Gemini throws", async () => {
      (globalThis as any).mockGeminiGenerateContent = async () => {
        throw new Error("API error");
      };
      const result = await parseVoiceTranscript("test", "batch");
      expect(result).toMatchObject({
        jenis_ikan: null,
        berat: null,
        harga_beli_per_kg: null,
        kondisi_kualitas: null,
        nama_supplier: null,
        catatan: null,
      });
    });

    it("returns empty suggestion when Gemini returns invalid JSON", async () => {
      (globalThis as any).mockGeminiGenerateContent = async () => ({
        response: { text: () => "bukan json sama sekali" },
      });
      const result = await parseVoiceTranscript("test", "batch");
      expect(result).toMatchObject({
        jenis_ikan: null,
        berat: null,
      });
    });
  });

  describe("other form types fallback", () => {
    it("returns empty supplier suggestion on failure", async () => {
      (globalThis as any).mockGeminiGenerateContent = async () => {
        throw new Error("API error");
      };
      const result = await parseVoiceTranscript("Pak Slamet 08123", "supplier");
      expect(result).toMatchObject({ nama: null, telepon: null, alamat: null, jenis_ikan_utama: null });
    });

    it("returns empty buyer suggestion on failure", async () => {
      (globalThis as any).mockGeminiGenerateContent = async () => {
        throw new Error("API error");
      };
      const result = await parseVoiceTranscript("Bu Aminah restoran", "buyer");
      expect(result).toMatchObject({ nama: null, telepon: null, tipe_pembeli: null, alamat: null });
    });
  });
});
