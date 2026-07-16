import { Hono } from "hono";
import { eq, and, sum, sql } from "drizzle-orm";
import { db } from "../db/client";
import { batches, sales, payments, batchExpenses, saleExtras } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { success } from "../lib/response";

const dashboardRoute = new Hono();

dashboardRoute.use("*", authMiddleware);

// GET /dashboard/summary — ringkasan utama
dashboardRoute.get("/summary", async (c) => {
  const { id: userId } = c.get("user");

  // 1. Omzet total = SUM(sales.total) untuk semua batch milik user
  const omzetResult = await db
    .select({ total: sum(sales.total) })
    .from(sales)
    .innerJoin(batches, eq(sales.batchId, batches.id))
    .where(eq(batches.userId, userId));

  const omzet = Number(omzetResult[0]?.total || 0);

  // 2. Total biaya aksesoris — dikeluarkan dari laba riil
  const extrasResult = await db
    .select({ total: sum(saleExtras.subtotal) })
    .from(saleExtras)
    .innerJoin(sales, eq(saleExtras.saleId, sales.id))
    .innerJoin(batches, eq(sales.batchId, batches.id))
    .where(eq(batches.userId, userId));

  const totalExtras = Number(extrasResult[0]?.total || 0);

  // 3. Total HPP (Harga Pokok Penjualan) = berat_jual × harga_beli_per_kg per sale
  const hppResult = await db
    .select({
      total: sum(sql<number>`${sales.beratJual}::numeric * ${batches.hargaBeliPerKg}::numeric`),
    })
    .from(sales)
    .innerJoin(batches, eq(sales.batchId, batches.id))
    .where(eq(batches.userId, userId));

  const totalHPP = Number(hppResult[0]?.total || 0);

  // 4. Total batch expenses (biaya operasional per batch)
  const expensesResult = await db
    .select({ total: sum(batchExpenses.jumlah) })
    .from(batchExpenses)
    .innerJoin(batches, eq(batchExpenses.batchId, batches.id))
    .where(eq(batches.userId, userId));

  const totalExpenses = Number(expensesResult[0]?.total || 0);

  // 5. Laba riil = omzet - extras - HPP - expenses
  const labaRiil = omzet - totalExtras - totalHPP - totalExpenses;

  // 6. Stok tersisa (kg) = SUM(berat) batch aktif
  const stokResult = await db
    .select({ total: sum(batches.berat) })
    .from(batches)
    .where(and(eq(batches.userId, userId), eq(batches.status, "aktif")));

  const stokTersisaKg = Number(stokResult[0]?.total || 0);

  // 7. Total piutang belum lunas
  const piutangResult = await db
    .select({ total: sum(sales.total) })
    .from(sales)
    .innerJoin(batches, eq(sales.batchId, batches.id))
    .where(and(eq(batches.userId, userId), eq(sales.statusBayar, "tempo")));

  // Kurangi dengan yang sudah dibayar sebagian
  const paidPartialResult = await db
    .select({ total: sum(payments.jumlahBayar) })
    .from(payments)
    .innerJoin(sales, eq(payments.saleId, sales.id))
    .innerJoin(batches, eq(sales.batchId, batches.id))
    .where(and(eq(batches.userId, userId), eq(sales.statusBayar, "tempo")));

  const totalPiutangBruto = Number(piutangResult[0]?.total || 0);
  const totalPaidPartial = Number(paidPartialResult[0]?.total || 0);
  const totalPiutang = Math.max(0, totalPiutangBruto - totalPaidPartial);

  // 8. Top batch — batch paling menguntungkan (laba riil per batch)
  const topBatchResult = await db.execute(sql`
    SELECT
      b.id,
      b.jenis_ikan,
      b.diterima_at,
      COALESCE(s_agg.total_penjualan, 0) as total_penjualan,
      COALESCE(e_agg.total_extras, 0) as total_extras,
      COALESCE(s_agg.total_hpp, 0) as total_hpp,
      COALESCE(exp_agg.total_expenses, 0) as total_expenses,
      (
        COALESCE(s_agg.total_penjualan, 0)
        - COALESCE(e_agg.total_extras, 0)
        - COALESCE(s_agg.total_hpp, 0)
        - COALESCE(exp_agg.total_expenses, 0)
      ) as laba_riil
    FROM batches b
    LEFT JOIN (
      SELECT
        batch_id,
        SUM(total::numeric) as total_penjualan,
        SUM(berat_jual::numeric * (
          SELECT harga_beli_per_kg::numeric FROM batches WHERE id = batch_id
        )) as total_hpp
      FROM sales
      GROUP BY batch_id
    ) s_agg ON s_agg.batch_id = b.id
    LEFT JOIN (
      SELECT s.batch_id, SUM(se.subtotal::numeric) as total_extras
      FROM sale_extras se
      JOIN sales s ON se.sale_id = s.id
      GROUP BY s.batch_id
    ) e_agg ON e_agg.batch_id = b.id
    LEFT JOIN (
      SELECT batch_id, SUM(jumlah::numeric) as total_expenses
      FROM batch_expenses
      GROUP BY batch_id
    ) exp_agg ON exp_agg.batch_id = b.id
    WHERE b.user_id = ${userId}
    ORDER BY laba_riil DESC
    LIMIT 3
  `);

  return c.json(success({
    omzet,
    laba_riil_total: labaRiil,
    stok_tersisa_kg: stokTersisaKg,
    total_piutang: totalPiutang,
    top_batch: (topBatchResult as any).map((row: any) => ({
      id: row.id,
      jenis_ikan: row.jenis_ikan,
      diterima_at: row.diterima_at,
      total_penjualan: Number(row.total_penjualan),
      total_extras: Number(row.total_extras),
      total_hpp: Number(row.total_hpp),
      total_expenses: Number(row.total_expenses),
      laba_riil: Number(row.laba_riil),
    })),
  }));
});

// GET /dashboard/waste-insight — insight penyusutan per kondisi/jenis ikan (Opsi B)
dashboardRoute.get("/waste-insight", async (c) => {
  const { id: userId } = c.get("user");

  const insightResult = await db.execute(sql`
    WITH batch_stats AS (
      SELECT
        b.id,
        b.jenis_ikan,
        b.kondisi_kualitas,
        COALESCE(s_agg.total_berat_jual, 0) as total_berat_jual,
        COALESCE(exp_agg.total_berat_susut, 0) as total_berat_susut,
        (b.berat::numeric + COALESCE(s_agg.total_berat_jual, 0) + COALESCE(exp_agg.total_berat_susut, 0)) as berat_awal
      FROM batches b
      LEFT JOIN (
        SELECT batch_id, SUM(berat_jual::numeric) as total_berat_jual
        FROM sales
        GROUP BY batch_id
      ) s_agg ON s_agg.batch_id = b.id
      LEFT JOIN (
        SELECT 
          be.batch_id, 
          SUM(be.jumlah::numeric / b.harga_beli_per_kg::numeric) as total_berat_susut
        FROM batch_expenses be
        JOIN batches b ON be.batch_id = b.id
        WHERE be.jenis_biaya = 'Susut/Rusak'
        GROUP BY be.batch_id
      ) exp_agg ON exp_agg.batch_id = b.id
      WHERE b.user_id = ${userId}
    )
    SELECT
      jenis_ikan,
      kondisi_kualitas,
      COUNT(*) as jumlah_batch,
      AVG(
        CASE 
          WHEN berat_awal > 0 THEN total_berat_susut / berat_awal
          ELSE 0
        END
      ) as rasio_susut_rata
    FROM batch_stats
    GROUP BY jenis_ikan, kondisi_kualitas
    ORDER BY rasio_susut_rata DESC
    LIMIT 10
  `);

  return c.json(success({
    insights: (insightResult as any).map((row: any) => ({
      jenis_ikan: row.jenis_ikan,
      kondisi_kualitas: row.kondisi_kualitas,
      jumlah_batch: Number(row.jumlah_batch),
      rasio_susut: Number(row.rasio_susut_rata).toFixed(4),
      rasio_susut_persen: `${(Number(row.rasio_susut_rata) * 100).toFixed(1)}%`,
    })),
  }));
});

export default dashboardRoute;
