import { describe, expect, test, vi } from "vitest";
import { getOrAnalyzeVisual, validCachedAnalysis, visualCachePath } from "../../lib/projects/visualAnalysisCache";
import { VisualCacheSchema, VisualRegionsSchema, VISUAL_ANALYSIS_SCHEMA_VERSION } from "../../src/providers/visualAnalysisSchema";
import { createGeminiVisualAnalyzer, MAX_VISUAL_ATTEMPTS, prepareVisualImage } from "../../src/providers/geminiVisualAnalyzer";
import sharp from "sharp";

const identity = { userId: "u", projectId: "p", panelId: "panel", imageRowId: "11111111-1111-4111-8111-111111111111", storagePath: "u/p/external/1/immutable.png" };
const fixture = { schema_version: VISUAL_ANALYSIS_SCHEMA_VERSION, image_identity: { image_row_id: identity.imageRowId, storage_path: identity.storagePath },
  regions: [{ type: "face", x: 0.1, y: 0.2, width: 0.2, height: 0.2, importance: 1 }], provider: "gemini", model: "test", created_at: new Date().toISOString() };
function setup() {
  const cache = new Map<string, unknown>();
  const store = { read: vi.fn(async (path: string) => cache.get(path) ?? null), write: vi.fn(async (path: string, value: unknown) => { cache.set(path, value); }) };
  const analyzer = { analyze: vi.fn(async () => VisualRegionsSchema.parse({ regions: fixture.regions })) };
  const load = vi.fn(async () => new Uint8Array([1]));
  const prepare = vi.fn(async (v: Uint8Array) => v);
  return { cache, store, analyzer, load, prepare };
}

describe("Visual cache and schema", () => {
  test.each(["face", "hair", "hand", "body", "important_object", "action", "text_or_logo"])("accepts %s", (type) => {
    expect(VisualRegionsSchema.safeParse({ regions: [{ ...fixture.regions[0], type }] }).success).toBe(true);
  });
  test("rejects invalid coordinates, importance, length and excess regions", () => {
    for (const change of [{ x: -0.1 }, { x: 0.9 }, { importance: 2 }, { width: 0 }, { label: "!" }]) {
      expect(VisualRegionsSchema.safeParse({ regions: [{ ...fixture.regions[0], ...change }] }).success).toBe(false);
    }
    expect(VisualRegionsSchema.safeParse({ regions: Array(81).fill(fixture.regions[0]) }).success).toBe(false);
  });
  test("cache miss writes once; hit uses no provider calls or image bytes", async () => {
    const { store, analyzer, load, prepare } = setup();
    expect((await getOrAnalyzeVisual(identity, store, analyzer, load, prepare)).status).toBe("ANALYZED");
    expect((await getOrAnalyzeVisual(identity, store, analyzer, load, prepare)).status).toBe("CACHED");
    expect(analyzer.analyze).toHaveBeenCalledTimes(1);
    expect(store.write).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
  });
  test("row ID, storage path and schema version each invalidate cache", async () => {
    const { cache, store, analyzer, load, prepare } = setup();
    cache.set(visualCachePath(identity), fixture);
    expect(validCachedAnalysis(fixture, identity)).not.toBeNull();
    expect(validCachedAnalysis(fixture, { ...identity, imageRowId: "22222222-2222-4222-8222-222222222222" })).toBeNull();
    expect(validCachedAnalysis(fixture, { ...identity, storagePath: "u/p/raw/1/new.png" })).toBeNull();
    expect(validCachedAnalysis({ ...fixture, schema_version: 2 }, identity)).toBeNull();
    await getOrAnalyzeVisual({ ...identity, storagePath: "u/p/raw/1/new.png" }, store, analyzer, load, prepare);
    expect(analyzer.analyze).toHaveBeenCalledTimes(1);
    expect(visualCachePath({ ...identity, storagePath: "u/p/raw/1/new.png" })).not.toBe(visualCachePath(identity));
    expect(VisualCacheSchema.safeParse(fixture).success).toBe(true);
  });
  test("invalid cache is rejected then replaced; analysis failure stays uncached", async () => {
    const { cache, store, analyzer, load, prepare } = setup();
    cache.set(visualCachePath(identity), { regions: [{ x: 8 }] });
    expect((await getOrAnalyzeVisual(identity, store, analyzer, load, prepare)).status).toBe("ANALYZED");
    const failed = setup(); failed.analyzer.analyze.mockRejectedValueOnce(Error("invalid"));
    expect((await getOrAnalyzeVisual({ ...identity, panelId: "other" }, failed.store, failed.analyzer, failed.load, failed.prepare)).status).toBe("ANALYSIS_FAILED");
    expect(failed.store.write).not.toHaveBeenCalled();
  });
  test("503 retry has three attempts at most; non-transient errors do not retry", async () => {
    const failure = Object.assign(Error("temporary"), { status: 503 });
    const generate = vi.fn().mockRejectedValueOnce(failure).mockRejectedValueOnce(failure).mockResolvedValue(JSON.stringify({ regions: [] }));
    const sleep = vi.fn(async () => {});
    expect((await createGeminiVisualAnalyzer({ generate, sleep }).analyze(new Uint8Array([1]), "image/png")).regions).toEqual([]);
    expect(generate).toHaveBeenCalledTimes(MAX_VISUAL_ATTEMPTS);
    expect(sleep.mock.calls).toHaveLength(2);
    const bad = vi.fn().mockRejectedValue(Object.assign(Error("quota"), { status: 429 }));
    await expect(createGeminiVisualAnalyzer({ generate: bad, sleep }).analyze(new Uint8Array([1]), "image/png")).rejects.toThrow("quota");
    expect(bad).toHaveBeenCalledTimes(1);
    const exhausted = vi.fn().mockRejectedValue(failure);
    await expect(createGeminiVisualAnalyzer({ generate: exhausted, sleep }).analyze(new Uint8Array([1]), "image/png")).rejects.toThrow("temporary");
    expect(exhausted).toHaveBeenCalledTimes(3);
    const malformed = vi.fn().mockResolvedValue("not json");
    await expect(createGeminiVisualAnalyzer({ generate: malformed, sleep }).analyze(new Uint8Array([1]), "image/png")).rejects.toThrow();
    expect(malformed).toHaveBeenCalledTimes(1);
  });
  test("analysis copy is bounded and aspect ratio survives; source bytes stay untouched", async () => {
    const source = new Uint8Array(await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "white" } }).png().toBuffer());
    const before = new Uint8Array(source);
    const copy = await prepareVisualImage(source);
    expect(await sharp(copy).metadata()).toMatchObject({ width: 1280, height: 640, format: "png" });
    expect(source).toEqual(before);
  });
});
