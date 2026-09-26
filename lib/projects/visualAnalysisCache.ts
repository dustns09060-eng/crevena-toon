import { createHash } from "node:crypto";
import { VISUAL_ANALYSIS_MODEL, VISUAL_ANALYSIS_SCHEMA_VERSION, VisualCacheSchema, type VisualCache, type VisualRegions } from "../../src/providers/visualAnalysisSchema";
import { VisualAnalysisError, type VisualAnalyzer, type VisualFailureCode } from "../../src/providers/geminiVisualAnalyzer";

export type ImageIdentity = { userId: string; projectId: string; panelId: string; imageRowId: string; storagePath: string };
export type AnalysisStatus = "CACHED" | "ANALYZED" | "ANALYSIS_FAILED";
export type AnalysisResult = { status: AnalysisStatus; regions: VisualRegions["regions"] | null; failureCode?: VisualFailureCode; attempts?: number };
export interface VisualCacheStore {
  read(path: string): Promise<unknown | null>;
  write(path: string, data: VisualCache): Promise<void>;
  tryLock?(path: string): Promise<boolean>;
  unlock?(path: string): Promise<void>;
}
export function visualCachePath(identity: ImageIdentity): string {
  const digest = createHash("sha256").update(identity.storagePath).digest("hex").slice(0, 24);
  return `${identity.userId}/${identity.projectId}/analysis/${identity.panelId}/${identity.imageRowId}/v${VISUAL_ANALYSIS_SCHEMA_VERSION}-${digest}.json`;
}
export function visualImageKey(identity: ImageIdentity): string {
  return createHash("sha256").update(`${identity.imageRowId}\0${identity.storagePath}\0${VISUAL_ANALYSIS_SCHEMA_VERSION}`).digest("hex");
}
/** Exact immutable-image paths; no prefix deletion and no other panel cache. */
export function selectiveReanalysisPaths(identity: ImageIdentity): { cache: string; marker: string } {
  const cache = visualCachePath(identity);
  return { cache, marker: `${cache}.manual-reanalysis` };
}
export function validCachedAnalysis(value: unknown, identity: ImageIdentity): VisualCache | null {
  const parsed = VisualCacheSchema.safeParse(value);
  return parsed.success && parsed.data.image_identity.image_row_id === identity.imageRowId
    && parsed.data.image_identity.storage_path === identity.storagePath ? parsed.data : null;
}

const running = new Map<string, Promise<AnalysisResult>>();
export async function getOrAnalyzeVisual(identity: ImageIdentity, store: VisualCacheStore, analyzer: VisualAnalyzer,
  loadImage: () => Promise<Uint8Array>, prepareImage: (bytes: Uint8Array) => Promise<Uint8Array>): Promise<AnalysisResult> {
  const path = visualCachePath(identity);
  const existing = validCachedAnalysis(await store.read(path).catch(() => null), identity);
  if (existing) return { status: "CACHED", regions: existing.regions };
  if (running.has(path)) return running.get(path)!;
  const task = (async () => {
    let locked = false;
    try {
      if (store.tryLock) {
        locked = await store.tryLock(path);
        if (!locked) {
          // A different server instance owns this immutable identity. Never duplicate its Vision call.
          for (let poll = 0; poll < 30; poll++) {
            await new Promise<void>((resolve) => setTimeout(resolve, 500));
            const shared = validCachedAnalysis(await store.read(path).catch(() => null), identity);
            if (shared) return { status: "CACHED" as const, regions: shared.regions };
          }
          throw new VisualAnalysisError("CACHE_LOCK_TIMEOUT");
        }
        // The winner may have completed between the initial read and lock acquisition.
        const shared = validCachedAnalysis(await store.read(path).catch(() => null), identity);
        if (shared) return { status: "CACHED" as const, regions: shared.regions };
      }
      let bytes: Uint8Array;
      try { bytes = await loadImage(); }
      catch { throw new VisualAnalysisError("IMAGE_DOWNLOAD_FAILED"); }
      let prepared: Uint8Array;
      try { prepared = await prepareImage(bytes); }
      catch { throw new VisualAnalysisError("IMAGE_PREPROCESS_FAILED"); }
      const result = await analyzer.analyze(prepared, "image/png");
      const parsed = VisualCacheSchema.safeParse({ schema_version: VISUAL_ANALYSIS_SCHEMA_VERSION,
        image_identity: { image_row_id: identity.imageRowId, storage_path: identity.storagePath },
        regions: result.regions, provider: "gemini", model: VISUAL_ANALYSIS_MODEL, created_at: new Date().toISOString() });
      if (!parsed.success) throw new VisualAnalysisError("VALIDATION_FAILED");
      const cache = parsed.data;
      try { await store.write(path, cache); }
      catch {
        // Another instance may have completed the same immutable identity first.
        if (!validCachedAnalysis(await store.read(path).catch(() => null), identity)) throw new VisualAnalysisError("CACHE_WRITE_FAILED");
      }
      return { status: "ANALYZED" as const, regions: cache.regions };
    } catch (error) { return { status: "ANALYSIS_FAILED" as const, regions: null,
      failureCode: error instanceof VisualAnalysisError ? error.failureCode : "UNKNOWN",
      attempts: error instanceof VisualAnalysisError ? error.attempts : 0 }; }
    finally {
      if (locked) await store.unlock?.(path).catch(() => undefined);
      running.delete(path);
    }
  })();
  running.set(path, task);
  return task;
}
