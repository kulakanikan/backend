import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { success, error } from "../lib/response";

const reportsRoute = new Hono();

reportsRoute.use("*", authMiddleware);

// GET /reports/financial — laporan keuangan dalam rentang tanggal
reportsRoute.get(
  "/financial",
  zValidator(
    "query",
    z.object({
      from: z.string().datetime({ message: "Format from harus ISO datetime, contoh: 2026-07-01T00:00:00.000Z" }),
      to: z.string().datetime({ message: "Format to harus ISO datetime, contoh: 2026-07-31T23:59:59.999Z" }),
    })
  ),
  async (c) => {
    const { id: userId } = c.get("user");
    const { from, to } = c.req.valid("query");

    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (fromDate > toDate) {
      return c.json(error("VALIDATION_ERROR", "Tanggal 'from' tidak boleh lebih besar dari 'to'"), 400);
    }

    // Semua sales dalam rentang tanggal milik user ini
    const salesInRange = await db.query.sales.findMany({
      where: (s, { and: andFn, gte: gteFn, lte: lteFn }) => {
        return andFn(
          gteFn(s.tanggal, fromDate),
          lteFn(s.tanggal, toDate)
        );
      },
      with: {
        batch: {
          columns: {
            userId: true,
            jenisIkan: true,
            hargaBeliPerKg: true,
          },
        },
        buyer: { columns: { nama: true, tipePembeli: true } },
        saleExtras: true,
        receipt: { columns: { nomorStruk: true } },
      },
      orderBy: (s, { desc }) => [desc(s.tanggal)],
    });

    // Filter: hanya sale yang batch-nya milik user ini
    const ownedSales = salesInRange.filter((s) => s.batch.userId === userId);

    // Hitung ringkasan
    let omzet = 0;
    let totalHPP = 0;
    let totalExtras = 0;
    let totalExpensesForPeriod = 0; // Karena periode ini, tapi batch expenses bisa multi-periode, kita keep 0 atau sum jika perlu.

    for (const sale of ownedSales) {
      omzet += Number(sale.total);
      const hpp = Number(sale.beratJual) * Number(sale.batch.hargaBeliPerKg);
      totalHPP += hpp;
      for (const extra of sale.saleExtras) {
        totalExtras += Number(extra.subtotal);
      }
    }

    const labaRiil = omzet - totalExtras - totalHPP - totalExpensesForPeriod;

    // Piutang outstanding (tempo, belum lunas) dalam periode
    const piutangOutstanding = ownedSales
      .filter((s) => s.statusBayar === "tempo")
      .map((s) => ({
        sale_id: s.id,
        nomor_struk: s.receipt?.nomorStruk,
        tanggal: s.tanggal,
        pembeli: s.buyer.nama,
        total: Number(s.total),
        status_bayar: s.statusBayar,
      }));

    // Histori transaksi
    const transaksi = ownedSales.map((s) => ({
      id: s.id,
      tanggal: s.tanggal,
      jenis_ikan: s.batch.jenisIkan,
      pembeli: s.buyer.nama,
      tipe_pembeli: s.buyer.tipePembeli,
      berat_jual: Number(s.beratJual),
      harga_satuan: Number(s.hargaSatuan),
      extras: s.saleExtras.map((e) => ({
        nama_item: e.namaItem,
        subtotal: Number(e.subtotal),
      })),
      total: Number(s.total),
      status_bayar: s.statusBayar,
      nomor_struk: s.receipt?.nomorStruk,
    }));

    return c.json(success({
      periode: { from, to },
      ringkasan: {
        omzet,
        laba_riil: labaRiil,
        jumlah_transaksi: ownedSales.length,
        total_piutang_outstanding: piutangOutstanding.reduce(
          (sum, p) => sum + p.total, 0
        ),
      },
      piutang_outstanding: piutangOutstanding,
      transaksi,
    }));
  }
);

export default reportsRoute;
