import { GoogleGenerativeAI } from "@google/generative-ai";

let genAI: GoogleGenerativeAI | null = null;

function getGenAI() {
  if (!genAI) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return genAI;
}

// ─── Type Definitions per form ───────────────────────────────────────────────

export type BatchSuggestion = {
  jenis_ikan: string | null;
  berat: number | null;           // kg
  harga_beli_per_kg: number | null; // rupiah
  kondisi_kualitas: string | null; // "segar", "sedang", "kurang"
  nama_supplier: string | null;
  catatan: string | null;
};

export type SupplierSuggestion = {
  nama: string | null;
  telepon: string | null;          // format: "08xx-xxxx-xxxx"
  alamat: string | null;
  jenis_ikan_utama: string | null; // ikan yang biasa dipasok
};

export type BuyerSuggestion = {
  nama: string | null;
  telepon: string | null;
  tipe_pembeli: string | null;     // "pasar", "restoran", "warung", "individual"
  alamat: string | null;
};

export type SaleSuggestion = {
  nama_pembeli: string | null;     // untuk lookup/autocomplete di FE
  jenis_ikan: string | null;       // untuk lookup batch di FE
  berat_jual: number | null;       // kg
  harga_satuan: number | null;     // rupiah per kg
  status_bayar: "lunas" | "tempo" | null;
  catatan: string | null;
};

export type BatchExpenseSuggestion = {
  keterangan: string | null;       // "es batu", "transport", "bongkar muat"
  jumlah: number | null;           // rupiah
};

export type VoiceSuggestion =
  | BatchSuggestion
  | SupplierSuggestion
  | BuyerSuggestion
  | SaleSuggestion
  | BatchExpenseSuggestion;

export type FormType = "batch" | "supplier" | "buyer" | "sale" | "batch_expense";

// ─── Prompt Templates ─────────────────────────────────────────────────────────

const FORM_PROMPTS: Record<FormType, { schema: string; instructions: string }> = {
  batch: {
    schema: `{
  "jenis_ikan": string | null,
  "berat": number | null,
  "harga_beli_per_kg": number | null,
  "kondisi_kualitas": string | null,
  "nama_supplier": string | null,
  "catatan": string | null
}`,
    instructions: `Ekstrak data batch pembelian ikan dari teks.
- "berat" dalam kg (angka saja, misal: 50)
- "harga_beli_per_kg" dalam rupiah (angka saja, misal: 25000)
- "kondisi_kualitas" hanya bisa: "segar", "sedang", atau "kurang"
- Jika kondisi tidak disebutkan, isi null
- Nama nelayan/pemasok masuk ke "nama_supplier"`,
  },

  supplier: {
    schema: `{
  "nama": string | null,
  "telepon": string | null,
  "alamat": string | null,
  "jenis_ikan_utama": string | null
}`,
    instructions: `Ekstrak data supplier/nelayan dari teks.
- "telepon" format angka tanpa strip, misal: "081234567890"
- "jenis_ikan_utama" adalah jenis ikan yang biasa dipasok supplier ini
- Jangan menebak nilai yang tidak disebutkan`,
  },

  buyer: {
    schema: `{
  "nama": string | null,
  "telepon": string | null,
  "tipe_pembeli": string | null,
  "alamat": string | null
}`,
    instructions: `Ekstrak data pembeli dari teks.
- "telepon" format angka tanpa strip, misal: "081234567890"
- "tipe_pembeli" hanya bisa: "pasar", "restoran", "warung", atau "individual"
- Jika tipe tidak disebutkan atau tidak jelas, isi null`,
  },

  sale: {
    schema: `{
  "nama_pembeli": string | null,
  "jenis_ikan": string | null,
  "berat_jual": number | null,
  "harga_satuan": number | null,
  "status_bayar": "lunas" | "tempo" | null,
  "catatan": string | null
}`,
    instructions: `Ekstrak data transaksi penjualan dari teks.
- "berat_jual" dalam kg (angka saja)
- "harga_satuan" dalam rupiah per kg (angka saja)
- "status_bayar" hanya bisa: "lunas" atau "tempo"
  - "lunas" = bayar tunai, cash, langsung, dibayar sekarang
  - "tempo" = hutang, kredit, bayar nanti, cicil
- Jika metode pembayaran tidak disebutkan, isi null`,
  },

  batch_expense: {
    schema: `{
  "keterangan": string | null,
  "jumlah": number | null
}`,
    instructions: `Ekstrak data pengeluaran/biaya batch dari teks.
- "jumlah" dalam rupiah (angka saja)
- "keterangan" adalah deskripsi biaya, misal: "es batu 3 karung", "ongkos transport", "biaya bongkar"
- Singkat tapi deskriptif`,
  },
};

// ─── Empty Fallbacks ──────────────────────────────────────────────────────────

const EMPTY_SUGGESTION: Record<FormType, VoiceSuggestion> = {
  batch: {
    jenis_ikan: null,
    berat: null,
    harga_beli_per_kg: null,
    kondisi_kualitas: null,
    nama_supplier: null,
    catatan: null,
  },
  supplier: { nama: null, telepon: null, alamat: null, jenis_ikan_utama: null },
  buyer: { nama: null, telepon: null, tipe_pembeli: null, alamat: null },
  sale: {
    nama_pembeli: null,
    jenis_ikan: null,
    berat_jual: null,
    harga_satuan: null,
    status_bayar: null,
    catatan: null,
  },
  batch_expense: { keterangan: null, jumlah: null },
};

// ─── Main Function ────────────────────────────────────────────────────────────

/**
 * Parse transkrip suara menjadi data terstruktur sesuai form_type.
 * Tidak pernah throw — fallback ke suggestion kosong jika Gemini gagal.
 */
export async function parseVoiceTranscript(
  transcript: string,
  formType: FormType
): Promise<VoiceSuggestion> {
  const { schema, instructions } = FORM_PROMPTS[formType];
  const empty = EMPTY_SUGGESTION[formType];

  const systemPrompt = `Kamu adalah parser data form aplikasi distribusi ikan.
${instructions}

Kembalikan HANYA JSON dengan schema persis berikut, tanpa teks atau penjelasan lain:
${schema}

Jika suatu field tidak disebutkan dalam teks, isi dengan null.
Jangan menebak nilai yang tidak ada di teks.
Untuk field numerik, kembalikan angka (bukan string).`;

  try {
    const model = getGenAI().getGenerativeModel({ model: "gemini-3.5-flash" });
    const prompt = `${systemPrompt}\n\nTeks:\n${transcript}`;
    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();

    // Strip markdown code fences jika ada
    const jsonText = responseText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = JSON.parse(jsonText);

    // Merge dengan empty untuk pastikan semua key ada (tidak ada key extra)
    const merged: Record<string, any> = {};
    for (const key of Object.keys(empty)) {
      merged[key] = parsed[key] !== undefined ? parsed[key] : null;
    }

    return merged as VoiceSuggestion;
  } catch (err) {
    console.error(`[Gemini] Failed to parse ${formType} transcript:`, err);
    return empty;
  }
}

/**
 * Parse file audio langsung menjadi data terstruktur menggunakan Gemini 1.5 Flash.
 */
export async function parseVoiceAudio(
  audioBase64: string,
  mimeType: string,
  formType: FormType
): Promise<VoiceSuggestion> {
  const { schema, instructions } = FORM_PROMPTS[formType];
  const empty = EMPTY_SUGGESTION[formType];

  const systemPrompt = `Kamu adalah parser data form aplikasi distribusi ikan.
${instructions}

Ekstrak informasi dari rekaman audio yang diberikan.
Kembalikan HANYA JSON dengan schema persis berikut, tanpa teks atau penjelasan lain:
${schema}

Jika suatu field tidak disebutkan dalam rekaman audio, isi dengan null.
Jangan menebak nilai yang tidak ada di rekaman audio.
Untuk field numerik, kembalikan angka (bukan string).`;

  try {
    const model = getGenAI().getGenerativeModel({ model: "gemini-3.5-flash" });
    const result = await model.generateContent([
      {
        inlineData: {
          data: audioBase64,
          mimeType: mimeType,
        },
      },
      systemPrompt,
    ]);
    const responseText = result.response.text().trim();

    // Strip markdown code fences jika ada
    const jsonText = responseText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = JSON.parse(jsonText);

    // Merge dengan empty untuk pastikan semua key ada (tidak ada key extra)
    const merged: Record<string, any> = {};
    for (const key of Object.keys(empty)) {
      merged[key] = parsed[key] !== undefined ? parsed[key] : null;
    }

    return merged as VoiceSuggestion;
  } catch (err) {
    console.error(`[Gemini] Failed to parse ${formType} audio:`, err);
    return empty;
  }
}

/**
 * Menghasilkan ringkasan bisnis cerdas berbasis data dashboard menggunakan Gemini 1.5 Flash.
 */
export async function generateDashboardAiSummary(data: {
  omzet: number;
  laba_riil_total: number;
  stok_tersisa_kg: number;
  total_piutang: number;
  top_batch: Array<{ jenis_ikan: string; laba_riil: number }>;
  insights: Array<{ jenis_ikan: string; kondisi_kualitas: string; rasio_susut_persen: string }>;
}): Promise<string> {
  const prompt = `Kamu adalah asisten bisnis AI pintar untuk distributor ikan (Juragan Ikan).
Berikan analisis bisnis singkat, padat, dan motivasional (maksimal 3 kalimat) dalam bahasa Indonesia santun dan profesional berdasarkan data toko berikut:

- Omzet Penjualan: Rp ${data.omzet.toLocaleString("id-ID")}
- Keuntungan Bersih (Laba Riil): Rp ${data.laba_riil_total.toLocaleString("id-ID")}
- Stok Ikan di Gudang: ${data.stok_tersisa_kg} Kg
- Total Piutang Tempo (Belum Lunas): Rp ${data.total_piutang.toLocaleString("id-ID")}
- 3 Produk Paling Menguntungkan: ${data.top_batch.map(b => `${b.jenis_ikan} (Laba: Rp ${b.laba_riil.toLocaleString("id-ID")})`).join(", ") || "-"}
- Rasio Penyusutan/Rusak Terbesar: ${data.insights.map(i => `${i.jenis_ikan} [${i.kondisi_kualitas}] (${i.rasio_susut_persen})`).join(", ") || "-"}

Tujuan utama analisis:
1. Sorot apakah keuangan sehat (bandingkan laba vs piutang tempo).
2. Sebutkan produk/ikan mana yang paling sukses.
3. Berikan saran operasional cepat (misalnya mengurangi penyusutan atau mempercepat penagihan piutang).
Jangan gunakan format markdown berlebihan seperti bullet points, gunakan 2-3 kalimat paragraf biasa saja.`;

  try {
    const model = getGenAI().getGenerativeModel({ model: "gemini-3.5-flash" });
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (err) {
    console.error("[Gemini] Failed to generate dashboard summary:", err);
    return "Gagal memuat ringkasan bisnis AI saat ini. Silakan coba beberapa saat lagi.";
  }
}
