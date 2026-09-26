import { z } from "zod";

export const VISUAL_ANALYSIS_SCHEMA_VERSION = 1;
export const VISUAL_ANALYSIS_MAX_SIDE = 1280;
export const VISUAL_ANALYSIS_MAX_REGIONS = 80;
/** Only rounding-sized model errors may be repaired; cached v1 objects keep their identity. */
export const VISUAL_COORDINATE_TOLERANCE = 0.015;
export const VISUAL_DISCARD_IMPORTANCE = 0.35;
const numericValue = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.length > 12 || !/^-?\d+(?:\.\d+)?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
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
export type VisualRegionSummary = { counts: Record<VisualRegion["type"], number>; importantObjects: string[]; actions: string[] };
export function summarizeVisualRegions(regions: VisualRegion[]): VisualRegionSummary {
  const counts = { face: 0, hair: 0, hand: 0, body: 0, important_object: 0, action: 0, text_or_logo: 0 };
  const importantObjects: string[] = [], actions: string[] = [];
  for (const region of regions) {
    counts[region.type]++;
    if (region.label && region.type === "important_object" && importantObjects.length < 12) importantObjects.push(region.label);
    if (region.label && region.type === "action" && actions.length < 12) actions.push(region.label);
  }
  return { counts, importantObjects, actions };
}
/** Validate the provider envelope, then repair small boundary errors per region.
 * A damaged face or significant region invalidates the analysis; a damaged
 * low-importance non-face region may be dropped without hiding a face. */
export function normalizeVisualResponse(value: unknown): VisualRegions | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  if (Object.keys(envelope).some((key) => key !== "regions") || !Array.isArray(envelope.regions)
    || envelope.regions.length > VISUAL_ANALYSIS_MAX_REGIONS) return null;
  const regions: VisualRegion[] = [];
  for (const raw of envelope.regions) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    const importance = numericValue(item.importance);
    const discardable = item.type !== "face" && importance !== null
      && importance >= 0 && importance <= VISUAL_DISCARD_IMPORTANCE;
    const numeric = [item.x, item.y, item.width, item.height, item.importance].map(numericValue);
    let candidate: Record<string, unknown> = { ...item };
    if (typeof candidate.label === "string") {
      const label = candidate.label.trim();
      if (!label || label.length > 40 || !/^[\p{L}\p{N} _-]+$/u.test(label)) delete candidate.label;
      else candidate.label = label;
    }
    if (numeric.every((n) => n !== null)) {
      const [x, y, width, height, weight] = numeric as number[];
      const t = VISUAL_COORDINATE_TOLERANCE;
      if (x >= -t && x <= 1 + t && y >= -t && y <= 1 + t
        && width > 0 && width <= 1 + t && height > 0 && height <= 1 + t
        && x + width <= 1 + t && y + height <= 1 + t && weight >= -t && weight <= 1 + t) {
        const clampedX = Math.max(0, Math.min(1, x)), clampedY = Math.max(0, Math.min(1, y));
        candidate = { ...candidate, x: clampedX, y: clampedY,
          width: Math.min(width, 1 - clampedX), height: Math.min(height, 1 - clampedY),
          importance: Math.max(0, Math.min(1, weight)) };
      }
    }
    const parsed = region.safeParse(candidate);
    if (parsed.success) regions.push(parsed.data);
    else if (!discardable) return null;
  }
  return { regions };
}
export const VisualCacheSchema = z.object({
  schema_version: z.literal(VISUAL_ANALYSIS_SCHEMA_VERSION),
  image_identity: z.object({ image_row_id: z.string().uuid(), storage_path: z.string().min(1).max(1000) }).strict(),
  regions: z.array(region).max(VISUAL_ANALYSIS_MAX_REGIONS),
  provider: z.literal("gemini"), model: z.string().min(1).max(100), created_at: z.string().datetime(),
}).strict();
export type VisualCache = z.infer<typeof VisualCacheSchema>;
