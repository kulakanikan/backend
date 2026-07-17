import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import { parseVoiceTranscript, parseVoiceAudio, type FormType } from "../services/gemini";
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
  transcript: z.string().min(3, "Transkrip terlalu pendek (min 3 karakter)").optional(),
  audio: z.string().optional(),
  mime_type: z.string().optional(),
  form_type: z.enum(
    VALID_FORM_TYPES as [FormType, ...FormType[]],
    { errorMap: () => ({ message: `form_type harus salah satu dari: ${VALID_FORM_TYPES.join(", ")}` }) }
  ),
}).refine(data => data.transcript || (data.audio && data.mime_type), {
  message: "Harus mengirimkan transcript atau audio + mime_type",
  path: ["transcript"]
});

// POST /api/voice/parse
// Body: { transcript?: string, audio?: string, mime_type?: string, form_type: "batch" | "supplier" | "buyer" | "sale" | "batch_expense" }
// Response: { success: true, data: { form_type, suggestion: {...} } }
voiceRoute.post(
  "/parse",
  zValidator("json", voiceParseSchema),
  async (c) => {
    const { transcript, audio, mime_type, form_type } = c.req.valid("json");

    let suggestion;
    if (audio && mime_type) {
      suggestion = await parseVoiceAudio(audio, mime_type, form_type);
    } else if (transcript) {
      suggestion = await parseVoiceTranscript(transcript, form_type);
    } else {
      return c.json({ success: false, error: "Harus mengirimkan transcript atau audio" }, 400);
    }

    return c.json(success({ form_type, suggestion }));
  }
);

export { voiceRoute };
export default voiceRoute;
