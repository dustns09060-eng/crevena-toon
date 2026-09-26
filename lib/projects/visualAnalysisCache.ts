import { createHash } from "node:crypto";
import { VISUAL_ANALYSIS_MODEL, VISUAL_ANALYSIS_SCHEMA_VERSION, VisualCacheSchema, type VisualCache, type VisualRegions } from "../../src/providers/visualAnalysisSchema";
import type { VisualAnalyzer } from "../../src/providers/geminiVisualAnalyzer";

export type ImageIdentity = { userId: string; projectId: string; panelId: string; imageRowId: string; storagePath: string };
export type AnalysisStatus = "CACHED" | "ANALYZED" | "ANALYSIS_FAILED";
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
export function validCachedAnalysis(value: unknown, identity: ImageIdentity): VisualCache | null {
  const parsed = VisualCacheSchema.safeParse(value);
  return parsed.success && parsed.data.image_identity.image_row_id === identity.imageRowId
    && parsed.data.image_identity.storage_path === identity.storagePath ? parsed.data : null;
}

const running = new Map<string, Promise<{ status: AnalysisStatus; regions: VisualRegions["regions"] | null }>>();
export async function getOrAnalyzeVisual(identity: ImageIdentity, store: VisualCacheStore, analyzer: VisualAnalyzer,
  loadImage: () => Promise<Uint8Array>, prepareImage: (bytes: Uint8Array) => Promise<Uint8Array>): Promise<{ status: AnalysisStatus; regions: VisualRegions["regions"] | null }> {
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
          throw Error("다른 요청의 이미지 분석이 완료되지 않았습니다.");
        }
        // The winner may have completed between the initial read and lock acquisition.
        const shared = validCachedAnalysis(await store.read(path).catch(() => null), identity);
        if (shared) return { status: "CACHED" as const, regions: shared.regions };
      }
      const prepared = await prepareImage(await loadImage());
      const result = await analyzer.analyze(prepared, "image/png");
      const cache = VisualCacheSchema.parse({ schema_version: VISUAL_ANALYSIS_SCHEMA_VERSION,
        image_identity: { image_row_id: identity.imageRowId, storage_path: identity.storagePath },
        regions: result.regions, provider: "gemini", model: VISUAL_ANALYSIS_MODEL, created_at: new Date().toISOString() });
      try { await store.write(path, cache); }
      catch {
        // Another instance may have completed the same immutable identity first.
        if (!validCachedAnalysis(await store.read(path).catch(() => null), identity)) throw Error("분석 cache 저장 실패");
      }
      return { status: "ANALYZED" as const, regions: cache.regions };
    } catch { return { status: "ANALYSIS_FAILED" as const, regions: null }; }
    finally {
      if (locked) await store.unlock?.(path).catch(() => undefined);
      running.delete(path);
    }
  })();
  running.set(path, task);
  return task;
}
