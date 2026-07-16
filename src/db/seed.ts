import { db } from "./client";
import { users, suppliers, batches, batchExpenses, buyers, sales, saleExtras, payments, receipts } from "./schema";
import { eq } from "drizzle-orm";

// ─── KONFIGURASI DEMO USER ─────────────────────────────────────────────────
const DEMO_GOOGLE_SUB = process.env.DEMO_GOOGLE_SUB || "demo_google_sub_12345";
const DEMO_EMAIL = process.env.DEMO_EMAIL || "demo@kulakan.id";
const DEMO_NAMA = "Bapak Hendra Kusuma";

// ─── HELPER ────────────────────────────────────────────────────────────────
function generateReceiptNumber(suffix: string): string {
  return `STR-20260715-${suffix}`;
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

// ─── MAIN SEED ─────────────────────────────────────────────────────────────
async function seed() {
  console.log("🌱 Memulai seed data demo...");

  // 1. Upsert demo user
  let demoUser = await db.query.users.findFirst({
    where: eq(users.googleSub, DEMO_GOOGLE_SUB),
  });

  if (!demoUser) {
    [demoUser] = await db.insert(users).values({
      googleSub: DEMO_GOOGLE_SUB,
      nama: DEMO_NAMA,
      email: DEMO_EMAIL,
      namaUsaha: "UD Mina Jaya Bahari",
      teleponUsaha: "081234567890",
    }).returning();
    console.log("✅ User demo dibuat:", demoUser.id);
  } else {
    [demoUser] = await db.update(users).set({
      namaUsaha: "UD Mina Jaya Bahari",
      teleponUsaha: "081234567890",
    }).where(eq(users.id, demoUser.id)).returning();
    console.log("✅ User demo sudah ada, profil di-update:", demoUser.id);
  }

  const userId = demoUser.id;

  // 2. Suppliers (Nelayan)
  const supplierData = [
    { namaNelayan: "Pak Slamet Riyadi", telepon: "081111222333", alamat: "Pelabuhan Muara Baru, Jakarta Utara" },
    { namaNelayan: "Pak Dahlan Iskan", telepon: "082222333444", alamat: "TPI Blanakan, Subang" },
    { namaNelayan: "Bu Siti Rahayu", telepon: "083333444555", alamat: "Pelabuhan Nizam Zachman, Jakarta" },
  ];

  const createdSuppliers: typeof suppliers.$inferSelect[] = [];
  for (const s of supplierData) {
    let supplier = await db.query.suppliers.findFirst({
      where: (sup, { and: andFn, eq: eqFn }) =>
        andFn(eqFn(sup.namaNelayan, s.namaNelayan), eqFn(sup.userId, userId)),
    });
    if (!supplier) {
      [supplier] = await db.insert(suppliers).values({ userId, ...s }).returning();
    }
    createdSuppliers.push(supplier);
  }
  console.log("✅ Suppliers:", createdSuppliers.length);

  // 3. Buyers (Pembeli)
  const buyerData = [
    { nama: "RM Sederhana Bahari", telepon: "021-8765432", tipePembeli: "restoran" },
    { nama: "Pasar Swalayan Indomaret", telepon: "021-9876543", tipePembeli: "pasar" },
    { nama: "Pak Warno (Warung Makan)", telepon: "0856789012", tipePembeli: "warung" },
    { nama: "Ibu Dewi Kurniasih", telepon: "087654321098", tipePembeli: "individual" },
  ];

  const createdBuyers: typeof buyers.$inferSelect[] = [];
  for (const b of buyerData) {
    let buyer = await db.query.buyers.findFirst({
      where: (byr, { and: andFn, eq: eqFn }) =>
        andFn(eqFn(byr.nama, b.nama), eqFn(byr.userId, userId)),
    });
    if (!buyer) {
      [buyer] = await db.insert(buyers).values({ userId, ...b }).returning();
    }
    createdBuyers.push(buyer);
  }
  console.log("✅ Buyers:", createdBuyers.length);

  // 4. Batches (Batch Ikan - Opsi B compatible)
  const batchData = [
    {
      supplierId: createdSuppliers[0].id,
      jenisIkan: "Tongkol",
      berat: "41.00", // 75 kg awal - 4 kg susut - 30 kg terjual
      hargaBeliPerKg: "22000",
      kondisiKualitas: "segar",
      sumberInput: "manual" as const,
      diterimaAt: daysAgo(7),
      status: "aktif" as const,
      susutKg: 4, // untuk di-seed ke expenses
    },
    {
      supplierId: createdSuppliers[1].id,
      jenisIkan: "Bandeng",
      berat: "48.00", // 50 kg awal - 2 kg susut
      hargaBeliPerKg: "28000",
      kondisiKualitas: "segar",
      sumberInput: "voice" as const,
      diterimaAt: daysAgo(3),
      status: "aktif" as const,
      susutKg: 2,
    },
    {
      supplierId: createdSuppliers[2].id,
      jenisIkan: "Cumi-cumi",
      berat: "0.00", // 30 kg awal - 6 kg susut - 24 kg terjual = 0 kg
      hargaBeliPerKg: "45000",
      kondisiKualitas: "beku",
      sumberInput: "manual" as const,
      diterimaAt: daysAgo(14),
      status: "habis" as const,
      susutKg: 6,
    },
    {
      supplierId: createdSuppliers[0].id,
      jenisIkan: "Kakap Merah",
      berat: "40.00", // 40 kg awal
      hargaBeliPerKg: "65000",
      kondisiKualitas: "segar",
      sumberInput: "voice" as const,
      diterimaAt: daysAgo(1),
      status: "aktif" as const,
      susutKg: 0,
    },
  ];

  const createdBatches: typeof batches.$inferSelect[] = [];
  for (const b of batchData) {
    let batch = await db.query.batches.findFirst({
      where: (bat, { and: andFn, eq: eqFn }) =>
        andFn(eqFn(bat.userId, userId), eqFn(bat.jenisIkan, b.jenisIkan), eqFn(bat.supplierId, b.supplierId)),
    });
    if (!batch) {
      const { susutKg, ...batchValues } = b;
      [batch] = await db.insert(batches).values({ userId, ...batchValues }).returning();

      // Tambah batch expenses standar
      await db.insert(batchExpenses).values([
        { batchId: batch.id, jenisBiaya: "Transportasi", jumlah: "50000", catatan: "Ongkos angkut dari pelabuhan" },
        { batchId: batch.id, jenisBiaya: "Es Batu", jumlah: "25000", catatan: "3 balok es" },
      ]);

      // Tambah expense Susut/Rusak jika ada susutKg > 0
      if (susutKg > 0) {
        const jumlahKerugian = susutKg * Number(b.hargaBeliPerKg);
        await db.insert(batchExpenses).values({
          batchId: batch.id,
          jenisBiaya: "Susut/Rusak",
          jumlah: jumlahKerugian.toString(),
          catatan: `Susut ${susutKg} kg`,
        });
      }
    }
    createdBatches.push(batch);
  }
  console.log("✅ Batches:", createdBatches.length);

  // 5. Sales (Transaksi) — buat untuk batch Tongkol & Cumi
  const tongkolBatch = createdBatches[0];
  const cumiBatch = createdBatches[2];
  const salesData = [
    // Sale 1 — lunas, ke RM Sederhana
    {
      batchId: tongkolBatch.id,
      buyerId: createdBuyers[0].id, // RM Sederhana
      beratJual: "20.00",
      hargaSatuan: "32000",
      total: "650000", // 20×32000 + 10000 (es batu)
      statusBayar: "lunas" as const,
      tanggal: daysAgo(6),
      extras: [{ namaItem: "Es Batu", jumlah: "2", hargaSatuan: "5000", subtotal: "10000" }],
      nomorStruk: "A1B2C3",
      lunas: true,
    },
    // Sale 2 — tempo, masih ada sisa cicilan
    {
      batchId: tongkolBatch.id,
      buyerId: createdBuyers[2].id, // Warung Pak Warno
      beratJual: "10.00",
      hargaSatuan: "33000",
      total: "345000", // 10×33000 + 15000 (plastik + es)
      statusBayar: "tempo" as const,
      tanggal: daysAgo(4),
      extras: [
        { namaItem: "Kantong Plastik", jumlah: "1", hargaSatuan: "5000", subtotal: "5000" },
        { namaItem: "Es Batu", jumlah: "1", hargaSatuan: "10000", subtotal: "10000" },
      ],
      nomorStruk: "D4E5F6",
      lunas: false,
      sudahBayar: "200000",
    },
    // Sale 3 — dari batch Cumi (sudah habis)
    {
      batchId: cumiBatch.id, // Cumi-cumi
      buyerId: createdBuyers[1].id, // Indomaret
      beratJual: "24.00",
      hargaSatuan: "52000",
      total: "1248000",
      statusBayar: "lunas" as const,
      tanggal: daysAgo(10),
      extras: [],
      nomorStruk: "G7H8I9",
      lunas: true,
    },
  ];

  for (const s of salesData) {
    const existing = await db.query.sales.findFirst({
      where: (sale, { eq: eqFn }) => eqFn(sale.batchId, s.batchId),
    });
    if (existing) continue;

    const [sale] = await db.insert(sales).values({
      batchId: s.batchId,
      buyerId: s.buyerId,
      beratJual: s.beratJual,
      hargaSatuan: s.hargaSatuan,
      total: s.total,
      statusBayar: s.statusBayar,
      tanggal: s.tanggal,
    }).returning();

    // Sale extras
    if (s.extras.length > 0) {
      await db.insert(saleExtras).values(
        s.extras.map((e) => ({ saleId: sale.id, ...e }))
      );
    }

    // Receipt
    await db.insert(receipts).values({
      saleId: sale.id,
      nomorStruk: generateReceiptNumber(s.nomorStruk),
      statusKirimWa: s.lunas ? "terkirim" : "belum_dikirim",
    });

    // Payment untuk yang tempo — sudah bayar sebagian
    if (!s.lunas && s.sudahBayar) {
      await db.insert(payments).values({
        saleId: sale.id,
        jumlahBayar: s.sudahBayar,
        metodeBayar: "transfer",
        dibayarAt: daysAgo(2),
      });
    }

    // Payment untuk yang lunas
    if (s.lunas) {
      await db.insert(payments).values({
        saleId: sale.id,
        jumlahBayar: s.total,
        metodeBayar: "cash",
        dibayarAt: s.tanggal,
      });
    }
  }

  console.log("✅ Sales dan payments di-seed.");
  console.log("");
  console.log("🎉 Seed selesai! Data demo siap untuk presentasi.");
  console.log(`   User demo: ${DEMO_EMAIL}`);
  console.log(`   Google Sub: ${DEMO_GOOGLE_SUB}`);
  console.log("");
  console.log("📋 Ringkasan data:");
  console.log(`   - ${createdSuppliers.length} suppliers (nelayan)`);
  console.log(`   - ${createdBuyers.length} buyers (pembeli)`);
  console.log(`   - ${createdBatches.length} batches ikan`);
  console.log("   - 3 transaksi (2 lunas, 1 tempo dengan cicilan)");
}

seed().catch((err) => {
  console.error("❌ Seed gagal:", err);
  process.exit(1);
});
