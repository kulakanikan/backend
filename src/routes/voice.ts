import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import { parseVoiceTranscript, type FormType } from "../services/gemini";
import { success } from "../lib/response";

const voiceRoute = new Hono();
voiceRoute.use("*", authMiddleware);

const VALID_FORM_TYPES: FormType[] = [
  "batch",
  "supplier",
  "buyer",
  "sale",
  "batch_expense",
];

const voiceParseSchema = z.object({
  transcript: z.string().min(3, "Transkrip terlalu pendek (min 3 karakter)"),
  form_type: z.enum(
    VALID_FORM_TYPES as [FormType, ...FormType[]],
    { errorMap: () => ({ message: `form_type harus salah satu dari: ${VALID_FORM_TYPES.join(", ")}` }) }
  ),
});

// POST /api/voice/parse
// Body: { transcript: string, form_type: "batch" | "supplier" | "buyer" | "sale" | "batch_expense" }
// Response: { success: true, data: { form_type, suggestion: {...} } }
voiceRoute.post(
  "/parse",
  zValidator("json", voiceParseSchema),
  async (c) => {
    const { transcript, form_type } = c.req.valid("json");

    // parseVoiceTranscript tidak pernah throw — always returns suggestion (nullable fields)
    const suggestion = await parseVoiceTranscript(transcript, form_type);

    return c.json(success({ form_type, suggestion }));
  }
);

export { voiceRoute };
export default voiceRoute;
