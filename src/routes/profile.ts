import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { users } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { success, error } from "../lib/response";

const profile = new Hono();

profile.use("*", authMiddleware);

profile.get("/", async (c) => {
  const { id } = c.get("user");

  const user = await db.query.users.findFirst({
    where: eq(users.id, id),
  });

  if (!user) {
    return c.json(error("USER_NOT_FOUND", "User tidak ditemukan"), 404);
  }

  return c.json(success({
    nama_usaha: user.namaUsaha,
    telepon_usaha: user.teleponUsaha,
    nama_google: user.nama,
    email: user.email,
    avatar_url: user.avatarUrl,
  }));
});

profile.patch(
  "/",
  zValidator(
    "json",
    z.object({
      nama_usaha: z.string().max(255).nullable().optional(),
      telepon_usaha: z.string().max(30).nullable().optional(),
    }).refine(
      (data) => data.nama_usaha !== undefined || data.telepon_usaha !== undefined,
      { message: "Minimal satu field harus disertakan: nama_usaha atau telepon_usaha" }
    )
  ),
  async (c) => {
    const { id } = c.get("user");
    const body = c.req.valid("json");

    const updateData: Partial<typeof users.$inferInsert> = {};
    if (body.nama_usaha !== undefined) updateData.namaUsaha = body.nama_usaha;
    if (body.telepon_usaha !== undefined) updateData.teleponUsaha = body.telepon_usaha;

    const [updated] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, id))
      .returning();

    if (!updated) {
      return c.json(error("USER_NOT_FOUND", "User tidak ditemukan"), 404);
    }

    return c.json(success({
      nama_usaha: updated.namaUsaha,
      telepon_usaha: updated.teleponUsaha,
    }));
  }
);

export default profile;
