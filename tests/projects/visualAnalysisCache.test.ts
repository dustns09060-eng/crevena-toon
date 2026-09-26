import { describe, expect, test, vi } from "vitest";
import { getOrAnalyzeVisual, validCachedAnalysis, visualCachePath } from "../../lib/projects/visualAnalysisCache";
import { VisualCacheSchema, VisualRegionsSchema, VISUAL_ANALYSIS_SCHEMA_VERSION, normalizeVisualResponse, summarizeVisualRegions } from "../../src/providers/visualAnalysisSchema";
import { createGeminiVisualAnalyzer, MAX_VISUAL_ATTEMPTS, prepareVisualImage, VisualAnalysisError } from "../../src/providers/geminiVisualAnalyzer";
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
  test("repairs only rounding-sized coordinate and importance overflow before strict cache validation", async () => {
    const near = { regions: [{ type: "face", x: -0.001, y: 0.82, width: 0.2, height: 0.19, importance: 1.001 }] };
    expect(normalizeVisualResponse(near)).toEqual({ regions: [{ type: "face", x: 0, y: 0.82, width: 0.2, height: expect.closeTo(0.18), importance: 1 }] });
    expect(VisualRegionsSchema.safeParse(normalizeVisualResponse(near)).success).toBe(true);
    expect(normalizeVisualResponse({ regions: [{ type: "face", x: -0.4, y: 0.2, width: 2, height: 0.2, importance: 1 }] })).toBeNull();
    const generate = vi.fn().mockResolvedValue(JSON.stringify(near));
    expect((await createGeminiVisualAnalyzer({ generate }).analyze(new Uint8Array([1]), "image/png")).regions).toHaveLength(1);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  test("drops one malformed low-importance non-face region but rejects a damaged face", () => {
    const good = { type: "face", x: 0.2, y: 0.2, width: 0.2, height: 0.2, importance: 1 };
    expect(normalizeVisualResponse({ regions: [good, { type: "important_object", x: -0.4, y: 0.1, width: 0.2, height: 0.2, importance: 0.2 }] })).toEqual({ regions: [good] });
    expect(normalizeVisualResponse({ regions: [good, { ...good, x: -0.4 }] })).toBeNull();
    expect(normalizeVisualResponse({ regions: [{ ...good, type: "unknown", importance: 0.9 }] })).toBeNull();
    expect(normalizeVisualResponse({ regions: [{ ...good, x: "0.2", importance: "1.0", label: "laptop!" }] })).toEqual({ regions: [good] });
    expect(normalizeVisualResponse({ regions: [{ ...good, x: "NaN" }] })).toBeNull();
    expect(normalizeVisualResponse({ regions: [], schema_version: 2 })).toBeNull();
    expect(normalizeVisualResponse({ regions: [] })).toEqual({ regions: [] });
  });
  test("short cache debug summary distinguishes a detected laptop from a missing one", () => {
    const face = VisualRegionsSchema.parse({ regions: fixture.regions }).regions[0];
    const object = { ...face, type: "important_object" as const, label: "laptop" };
    expect(summarizeVisualRegions([face, object])).toMatchObject({ counts: { face: 1, important_object: 1 }, importantObjects: ["laptop"] });
    expect(summarizeVisualRegions([face]).importantObjects).toEqual([]);
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
    await expect(createGeminiVisualAnalyzer({ generate: bad, sleep }).analyze(new Uint8Array([1]), "image/png")).rejects.toMatchObject({ failureCode: "PROVIDER_ERROR", attempts: 1, httpStatus: 429 });
    expect(bad).toHaveBeenCalledTimes(1);
    const exhausted = vi.fn().mockRejectedValue(failure);
    await expect(createGeminiVisualAnalyzer({ generate: exhausted, sleep }).analyze(new Uint8Array([1]), "image/png")).rejects.toMatchObject({ failureCode: "PROVIDER_503", attempts: 3 });
    expect(exhausted).toHaveBeenCalledTimes(3);
    const malformed = vi.fn().mockResolvedValue("not json");
    await expect(createGeminiVisualAnalyzer({ generate: malformed, sleep }).analyze(new Uint8Array([1]), "image/png")).rejects.toThrow();
    expect(malformed).toHaveBeenCalledTimes(1);
  });
  test("structured failure codes and attempt logs distinguish response and provider failures", async () => {
    const sleep = vi.fn(async () => {}), onAttempt = vi.fn();
    const call = async (generate: () => Promise<string>) => createGeminiVisualAnalyzer({ generate, sleep, onAttempt }).analyze(new Uint8Array([1]), "image/png");
    await expect(call(async () => "{" )).rejects.toMatchObject({ failureCode: "INVALID_STRUCTURED_RESPONSE", attempts: 1 });
    await expect(call(async () => JSON.stringify({ regions: [{ type: "face", x: 1.1 }] }))).rejects.toMatchObject({ failureCode: "VALIDATION_FAILED", attempts: 1 });
    for (const status of [400, 401, 403, 429]) {
      const generate = vi.fn().mockRejectedValue(Object.assign(Error("do not log"), { status, code: "UNAVAILABLE" }));
      await expect(call(generate)).rejects.toMatchObject({ failureCode: "PROVIDER_ERROR", attempts: 1, httpStatus: status });
      expect(generate).toHaveBeenCalledTimes(1);
    }
    const generate = vi.fn().mockRejectedValueOnce(Object.assign(Error("temporary"), { status: "UNAVAILABLE" })).mockResolvedValue(JSON.stringify({ regions: [] }));
    await call(generate);
    expect(onAttempt).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1, failureCode: "PROVIDER_503", retry: true }));
    expect(generate).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
  test("failed analysis never becomes reusable cache; successful existing cache is preserved", async () => {
    const { cache, store, analyzer, load, prepare } = setup();
    const good = { ...identity, panelId: "good" }, bad = { ...identity, panelId: "bad" };
    cache.set(visualCachePath(good), fixture);
    analyzer.analyze.mockRejectedValueOnce(new VisualAnalysisError("VALIDATION_FAILED", 1));
    expect(await getOrAnalyzeVisual(bad, store, analyzer, load, prepare)).toMatchObject({ status: "ANALYSIS_FAILED", failureCode: "VALIDATION_FAILED", attempts: 1 });
    expect(store.write).not.toHaveBeenCalled();
    expect(await getOrAnalyzeVisual(good, store, analyzer, load, prepare)).toMatchObject({ status: "CACHED" });
    expect(analyzer.analyze).toHaveBeenCalledTimes(1);
    expect((await getOrAnalyzeVisual(bad, store, analyzer, load, prepare)).status).toBe("ANALYZED");
    expect(analyzer.analyze).toHaveBeenCalledTimes(2);
  });
  test("image download, preprocessing and lock timeout have distinct codes", async () => {
    const { store, analyzer, load, prepare } = setup();
    load.mockRejectedValueOnce(Error("private URL"));
    expect(await getOrAnalyzeVisual(identity, store, analyzer, load, prepare)).toMatchObject({ failureCode: "IMAGE_DOWNLOAD_FAILED" });
    prepare.mockRejectedValueOnce(Error("invalid bytes"));
    expect(await getOrAnalyzeVisual(identity, store, analyzer, load, prepare)).toMatchObject({ failureCode: "IMAGE_PREPROCESS_FAILED" });
    expect(store.write).not.toHaveBeenCalled();
  });
  test("seven valid cache objects are reused on the next preview; four failures remain uncached", async () => {
    const { cache, store, analyzer, load, prepare } = setup();
    const identities = Array.from({ length: 11 }, (_, i) => ({ ...identity, panelId: `panel-${i}` }));
    for (const item of identities.slice(0, 7)) cache.set(visualCachePath(item), fixture);
    analyzer.analyze.mockRejectedValue(new VisualAnalysisError("PROVIDER_503", 3, 503, "UNAVAILABLE"));
    const first = await Promise.all(identities.map((item) => getOrAnalyzeVisual(item, store, analyzer, load, prepare)));
    expect(first.map((item) => item.status)).toEqual([...Array(7).fill("CACHED"), ...Array(4).fill("ANALYSIS_FAILED")]);
    expect(analyzer.analyze).toHaveBeenCalledTimes(4);
    expect(store.write).not.toHaveBeenCalled();
    const second = await Promise.all(identities.slice(0, 7).map((item) => getOrAnalyzeVisual(item, store, analyzer, load, prepare)));
    expect(second.every((item) => item.status === "CACHED")).toBe(true);
    expect(analyzer.analyze).toHaveBeenCalledTimes(4);
  });
  test("analysis copy is bounded and aspect ratio survives; source bytes stay untouched", async () => {
    const source = new Uint8Array(await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "white" } }).png().toBuffer());
    const before = new Uint8Array(source);
    const copy = await prepareVisualImage(source);
    expect(await sharp(copy).metadata()).toMatchObject({ width: 1280, height: 640, format: "png" });
    expect(source).toEqual(before);
  });
});
