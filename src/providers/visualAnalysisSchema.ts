import { z } from "zod";

export const VISUAL_ANALYSIS_SCHEMA_VERSION = 1;
export const VISUAL_ANALYSIS_MAX_SIDE = 1280;
export const VISUAL_ANALYSIS_MAX_REGIONS = 80;
export const VISUAL_ANALYSIS_MODEL = process.env.GEMINI_VISUAL_ANALYSIS_MODEL ?? process.env.GEMINI_ANALYSIS_MODEL ?? "gemini-3.6-flash";

const region = z.object({
  type: z.enum(["face", "hair", "hand", "body", "important_object", "action", "text_or_logo"]),
  x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  width: z.number().gt(0).max(1), height: z.number().gt(0).max(1),
  importance: z.number().min(0).max(1),
  label: z.string().trim().min(1).max(40).regex(/^[\p{L}\p{N} _-]+$/u).optional(),
}).strict().refine((r) => r.x + r.width <= 1 && r.y + r.height <= 1, "영역이 이미지 밖에 있습니다.");

export const VisualRegionsSchema = z.object({ regions: z.array(region).max(VISUAL_ANALYSIS_MAX_REGIONS) }).strict();
export type VisualRegion = z.infer<typeof region>;
export type VisualRegions = z.infer<typeof VisualRegionsSchema>;
export const VisualCacheSchema = z.object({
  schema_version: z.literal(VISUAL_ANALYSIS_SCHEMA_VERSION),
  image_identity: z.object({ image_row_id: z.string().uuid(), storage_path: z.string().min(1).max(1000) }).strict(),
  regions: z.array(region).max(VISUAL_ANALYSIS_MAX_REGIONS),
  provider: z.literal("gemini"), model: z.string().min(1).max(100), created_at: z.string().datetime(),
}).strict();
export type VisualCache = z.infer<typeof VisualCacheSchema>;
