import {
  pgTable, uuid, varchar, decimal, timestamp, text, pgEnum
} from "drizzle-orm/pg-core";

// Enums
export const sumberInputEnum = pgEnum("sumber_input_type", ["voice", "manual"]);
export const statusBatchEnum = pgEnum("status_batch_type", ["aktif", "habis"]);
export const statusBayarEnum = pgEnum("status_bayar_type", ["lunas", "tempo"]);
export const statusKirimWaEnum = pgEnum("status_kirim_wa_type", ["belum_dikirim", "terkirim"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  googleSub: varchar("google_sub", { length: 255 }).notNull().unique(),
  nama: varchar("nama", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  avatarUrl: text("avatar_url"),
  namaUsaha: varchar("nama_usaha", { length: 255 }),
  teleponUsaha: varchar("telepon_usaha", { length: 30 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  namaNelayan: varchar("nama_nelayan", { length: 255 }).notNull(),
  telepon: varchar("telepon", { length: 30 }),
  alamat: text("alamat"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const batches = pgTable("batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  supplierId: uuid("supplier_id").references(() => suppliers.id).notNull(),
  jenisIkan: varchar("jenis_ikan", { length: 100 }).notNull(),
  berat: decimal("berat", { precision: 10, scale: 2 }).notNull(),
  hargaBeliPerKg: decimal("harga_beli_per_kg", { precision: 12, scale: 2 }).notNull(),
  kondisiKualitas: varchar("kondisi_kualitas", { length: 50 }),
  sumberInput: sumberInputEnum("sumber_input").notNull(),
  status: statusBatchEnum("status").notNull().default("aktif"),
  diterimaAt: timestamp("diterima_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const batchExpenses = pgTable("batch_expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id").references(() => batches.id).notNull(),
  jenisBiaya: varchar("jenis_biaya", { length: 100 }).notNull(),
  jumlah: decimal("jumlah", { precision: 12, scale: 2 }).notNull(),
  catatan: text("catatan"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const buyers = pgTable("buyers", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  nama: varchar("nama", { length: 255 }).notNull(),
  telepon: varchar("telepon", { length: 30 }),
  tipePembeli: varchar("tipe_pembeli", { length: 50 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sales = pgTable("sales", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id").references(() => batches.id).notNull(),
  buyerId: uuid("buyer_id").references(() => buyers.id).notNull(),
  beratJual: decimal("berat_jual", { precision: 10, scale: 2 }).notNull(),
  hargaSatuan: decimal("harga_satuan", { precision: 12, scale: 2 }).notNull(),
  total: decimal("total", { precision: 14, scale: 2 }).notNull(),
  statusBayar: statusBayarEnum("status_bayar").notNull().default("tempo"),
  tanggal: timestamp("tanggal").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const saleExtras = pgTable("sale_extras", {
  id: uuid("id").primaryKey().defaultRandom(),
  saleId: uuid("sale_id").references(() => sales.id).notNull(),
  namaItem: varchar("nama_item", { length: 100 }).notNull(),
  jumlah: decimal("jumlah", { precision: 10, scale: 2 }).notNull(),
  hargaSatuan: decimal("harga_satuan", { precision: 12, scale: 2 }).notNull(),
  subtotal: decimal("subtotal", { precision: 14, scale: 2 }).notNull(),
});

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  saleId: uuid("sale_id").references(() => sales.id).notNull(),
  jumlahBayar: decimal("jumlah_bayar", { precision: 14, scale: 2 }).notNull(),
  metodeBayar: varchar("metode_bayar", { length: 50 }).notNull(),
  dibayarAt: timestamp("dibayar_at").notNull(),
});

export const receipts = pgTable("receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  saleId: uuid("sale_id").references(() => sales.id).notNull().unique(),
  nomorStruk: varchar("nomor_struk", { length: 50 }).notNull().unique(),
  statusKirimWa: statusKirimWaEnum("status_kirim_wa").notNull().default("belum_dikirim"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
