import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { receipts, users } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { success, error } from "../lib/response";

const receiptsRoute = new Hono();

receiptsRoute.use("*", authMiddleware);

// Helper: format angka ke Rupiah Indonesia
function formatRupiah(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(amount);
}

// Helper: format teks struk untuk WhatsApp
function formatReceiptText(data: {
  nomorStruk: string;
  tanggal: Date;
  penjual: { namaUsaha: string | null; teleponUsaha: string | null; nama: string };
  pembeli: { nama: string; telepon: string | null };
  jenisIkan: string;
  beratJual: number;
  hargaSatuan: number;
  extras: Array<{ namaItem: string; jumlah: number; hargaSatuan: number; subtotal: number }>;
  total: number;
}): string {
  const lines: string[] = [
    `*STRUK PENJUALAN IKAN*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `No. Struk: ${data.nomorStruk}`,
    `Tanggal: ${data.tanggal.toLocaleDateString("id-ID")}`,
    ``,
    `*Dari:* ${data.penjual.namaUsaha || data.penjual.nama}`,
    data.penjual.teleponUsaha ? `Telp: ${data.penjual.teleponUsaha}` : "",
    ``,
    `*Kepada:* ${data.pembeli.nama}`,
    data.pembeli.telepon ? `Telp: ${data.pembeli.telepon}` : "",
    ``,
    `*Detail Transaksi:*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `${data.jenisIkan}`,
    `  ${data.beratJual} kg × ${formatRupiah(data.hargaSatuan)}`,
    `  = ${formatRupiah(data.beratJual * data.hargaSatuan)}`,
  ];

  for (const extra of data.extras) {
    lines.push(`${extra.namaItem}`);
    lines.push(`  ${extra.jumlah} × ${formatRupiah(extra.hargaSatuan)} = ${formatRupiah(extra.subtotal)}`);
  }

  lines.push(`━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`*TOTAL: ${formatRupiah(data.total)}*`);
  lines.push(``);
  lines.push(`Terima kasih! 🐟`);

  return lines.filter((l) => l !== "").join("\n");
}

// GET /receipts/:id — detail lengkap untuk render struk
receiptsRoute.get("/:id", async (c) => {
  const { id: userId } = c.get("user");
  const receiptId = c.req.param("id");

  const receipt = await db.query.receipts.findFirst({
    where: eq(receipts.id, receiptId),
    with: {
      sale: {
        with: {
          batch: {
            columns: { userId: true, jenisIkan: true },
          },
          buyer: true,
          saleExtras: true,
        },
      },
    },
  });

  if (!receipt || receipt.sale.batch.userId !== userId) {
    return c.json(error("NOT_FOUND", "Struk tidak ditemukan"), 404);
  }

  // Ambil profil penjual (user pemilik)
  const penjual = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { nama: true, namaUsaha: true, teleponUsaha: true },
  });

  return c.json(success({
    receipt: {
      id: receipt.id,
      nomor_struk: receipt.nomorStruk,
      status_kirim_wa: receipt.statusKirimWa,
      created_at: receipt.createdAt,
    },
    sale: {
      id: receipt.sale.id,
      berat_jual: receipt.sale.beratJual,
      harga_satuan: receipt.sale.hargaSatuan,
      total: receipt.sale.total,
      status_bayar: receipt.sale.statusBayar,
      tanggal: receipt.sale.tanggal,
      extras: receipt.sale.saleExtras,
    },
    buyer: receipt.sale.buyer,
    batch: { jenis_ikan: receipt.sale.batch.jenisIkan },
    penjual: {
      nama_usaha: penjual?.namaUsaha || penjual?.nama || "",
      telepon_usaha: penjual?.teleponUsaha,
    },
  }));
});

// POST /receipts/:id/send-wa — generate WA deep link + update status
receiptsRoute.post(
  "/:id/send-wa",
  zValidator(
    "json",
    z.object({
      phone_number: z.string().min(10).max(20),
    })
  ),
  async (c) => {
    const { id: userId } = c.get("user");
    const receiptId = c.req.param("id");
    const { phone_number } = c.req.valid("json");

    const receipt = await db.query.receipts.findFirst({
      where: eq(receipts.id, receiptId),
      with: {
        sale: {
          with: {
            batch: { columns: { userId: true, jenisIkan: true } },
            buyer: true,
            saleExtras: true,
          },
        },
      },
    });

    if (!receipt || receipt.sale.batch.userId !== userId) {
      return c.json(error("NOT_FOUND", "Struk tidak ditemukan"), 404);
    }

    // Ambil profil penjual
    const penjual = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { nama: true, namaUsaha: true, teleponUsaha: true },
    });

    // Format teks struk
    const receiptText = formatReceiptText({
      nomorStruk: receipt.nomorStruk,
      tanggal: receipt.sale.tanggal,
      penjual: {
        namaUsaha: penjual?.namaUsaha || null,
        teleponUsaha: penjual?.teleponUsaha || null,
        nama: penjual?.nama || "",
      },
      pembeli: {
        nama: receipt.sale.buyer.nama,
        telepon: receipt.sale.buyer.telepon,
      },
      jenisIkan: receipt.sale.batch.jenisIkan,
      beratJual: Number(receipt.sale.beratJual),
      hargaSatuan: Number(receipt.sale.hargaSatuan),
      extras: receipt.sale.saleExtras.map((e) => ({
        namaItem: e.namaItem,
        jumlah: Number(e.jumlah),
        hargaSatuan: Number(e.hargaSatuan),
        subtotal: Number(e.subtotal),
      })),
      total: Number(receipt.sale.total),
    });

    // Normalisasi nomor telepon — wa.me butuh format internasional tanpa +
    const normalizedPhone = phone_number.replace(/[^0-9]/g, "");
    const waPhone = normalizedPhone.startsWith("0")
      ? "62" + normalizedPhone.slice(1)
      : normalizedPhone;

    const waLink = `https://wa.me/${waPhone}?text=${encodeURIComponent(receiptText)}`;

    // Update status_kirim_wa
    await db
      .update(receipts)
      .set({ statusKirimWa: "terkirim" })
      .where(eq(receipts.id, receiptId));

    return c.json(success({ wa_link: waLink }));
  }
);

export default receiptsRoute;
