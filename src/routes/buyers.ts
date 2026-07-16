import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client";
import { buyers } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { success, error } from "../lib/response";

const buyersRoute = new Hono();

buyersRoute.use("*", authMiddleware);

// GET /buyers — list semua pembeli milik user
buyersRoute.get("/", async (c) => {
  const { id: userId } = c.get("user");

  const result = await db.query.buyers.findMany({
    where: eq(buyers.userId, userId),
    orderBy: (b, { asc }) => [asc(b.nama)],
  });

  return c.json(success({ buyers: result }));
});

// POST /buyers — tambah pembeli baru
buyersRoute.post(
  "/",
  zValidator(
    "json",
    z.object({
      nama: z.string().min(1).max(255),
      telepon: z.string().max(30).optional(),
      tipe_pembeli: z.string().max(50).optional(),
    })
  ),
  async (c) => {
    const { id: userId } = c.get("user");
    const body = c.req.valid("json");

    const [buyer] = await db.insert(buyers).values({
      userId,
      nama: body.nama,
      telepon: body.telepon,
      tipePembeli: body.tipe_pembeli, // boleh undefined → NULL di DB
    }).returning();

    return c.json(success({ buyer }), 201);
  }
);

// GET /buyers/:id — detail satu pembeli
buyersRoute.get("/:id", async (c) => {
  const { id: userId } = c.get("user");
  const buyerId = c.req.param("id");

  const buyer = await db.query.buyers.findFirst({
    where: and(eq(buyers.id, buyerId), eq(buyers.userId, userId)),
  });

  if (!buyer) {
    return c.json(error("NOT_FOUND", "Pembeli tidak ditemukan"), 404);
  }

  return c.json(success({ buyer }));
});

// PATCH /buyers/:id — update data pembeli
buyersRoute.patch(
  "/:id",
  zValidator(
    "json",
    z.object({
      nama: z.string().min(1).max(255).optional(),
      telepon: z.string().max(30).nullable().optional(),
      tipe_pembeli: z.string().min(1).max(50).optional(),
    })
  ),
  async (c) => {
    const { id: userId } = c.get("user");
    const buyerId = c.req.param("id");
    const body = c.req.valid("json");

    const existing = await db.query.buyers.findFirst({
      where: and(eq(buyers.id, buyerId), eq(buyers.userId, userId)),
    });

    if (!existing) {
      return c.json(error("NOT_FOUND", "Pembeli tidak ditemukan"), 404);
    }

    const updateData: Partial<typeof buyers.$inferInsert> = {};
    if (body.nama !== undefined) updateData.nama = body.nama;
    if (body.telepon !== undefined) updateData.telepon = body.telepon;
    if (body.tipe_pembeli !== undefined) updateData.tipePembeli = body.tipe_pembeli;

    const [updated] = await db
      .update(buyers)
      .set(updateData)
      .where(and(eq(buyers.id, buyerId), eq(buyers.userId, userId)))
      .returning();

    return c.json(success({ buyer: updated }));
  }
);

export default buyersRoute;
