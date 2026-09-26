import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ToonPanel } from "../../src/db/types";
import { visualCachePath, visualImageKey } from "../../lib/projects/visualAnalysisCache";

const userId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const imageRowId = "33333333-3333-4333-8333-333333333333";
const panelId = "44444444-4444-4444-8444-444444444444";
const path = `${userId}/${projectId}/external/1/immutable.png`;
const identity = { userId, projectId, panelId, imageRowId, storagePath: path };
const state = { panel: {} as ToonPanel, cache: new Map<string, unknown>(), writes: [] as Record<string, unknown>[], failed: false, provider: "external" };
const analyze = vi.fn(async () => ({ regions: [] }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../../src/providers/geminiVisualAnalyzer", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/providers/geminiVisualAnalyzer")>(),
  createGeminiVisualAnalyzer: () => ({ analyze }),
  prepareVisualImage: async (bytes: Uint8Array) => bytes,
}));
vi.mock("../../lib/projects/service", () => ({
  getProject: async () => ({ id: projectId, user_id: userId, status: "confirmed", panel_count: 1 }),
  getProjectPanels: async () => [structuredClone(state.panel)],
}));
vi.mock("../../lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
  storage: { from: () => ({
    download: async (key: string) => state.cache.has(key)
      ? { data: new Blob([JSON.stringify(state.cache.get(key))]), error: null }
      : { data: null, error: Error("missing") },
    upload: async (key: string, value: string) => { state.cache.set(key, key.endsWith(".lock") ? value : JSON.parse(value)); return { error: null }; },
    remove: async (keys: string[]) => { keys.forEach((key) => state.cache.delete(key)); return { error: null }; },
  }) },
  from: (table: string) => {
    if (table === "toon_panel_images") return {
      select: () => ({ in: () => ({ eq: async () => ({ data: [{ id: imageRowId, panel_id: panelId, storage_path: path, provider: state.provider }], error: null }) }) }),
    };
    let values: Record<string, unknown> = {};
    const filters: Record<string, unknown> = {};
    const chain = {
      update(value: Record<string, unknown>) { values = value; return chain; },
      eq(key: string, value: unknown) { filters[key] = value; return chain; },
      select() { return chain; },
      then(resolve: (result: unknown) => void) {
        state.writes.push(values);
        if (state.failed) return resolve({ data: null, error: Error("write failed") });
        if (filters.id !== state.panel.id || filters.updated_at !== state.panel.updated_at) return resolve({ data: [], error: null });
        Object.assign(state.panel, values); state.panel.updated_at = "2026-09-26T02:00:01.000Z";
        resolve({ data: [{ id: state.panel.id, updated_at: state.panel.updated_at }], error: null });
      },
    };
    return chain;
  },
}) }));

beforeEach(() => {
  state.panel = { id: panelId, project_id: projectId, panel_number: 1, panel_type: "cover", updated_at: "2026-09-26T02:00:00.000Z",
    cover_title: "표지", cover_subtitle: "부제", cover_title_bubble: null, dialogue: [], narration: null, narration_bubble: null,
    raw_image_url: path, image_url: "final/unchanged", scene: "existing", image_prompt: "existing", expression: "existing" } as ToonPanel;
  state.cache.clear(); state.writes = []; state.failed = false; state.provider = "external"; analyze.mockClear();
  state.cache.set(visualCachePath(identity), { schema_version: 1,
    image_identity: { image_row_id: imageRowId, storage_path: path }, regions: [],
    provider: "gemini", model: "test", created_at: "2026-09-26T02:00:00.000Z" });
});

describe("v2 server preview and apply", () => {
  test("cached Preview reads only, then explicit apply saves layout and provenance only", async () => {
    const { prepareSmartV2PreviewAction, applySmartV2Action } = await import("../../lib/projects/smartLayoutV2");
    const before = structuredClone(state.panel);
    const preview = await prepareSmartV2PreviewAction(projectId, false);
    expect(preview.ok).toBe(true);
    expect(preview.entries?.[0]).toMatchObject({ analysis: "CACHED", result: { status: "PASS" } });
    expect(analyze).not.toHaveBeenCalled();
    expect(state.writes).toHaveLength(0);
    expect(state.panel).toEqual(before);
    const result = await applySmartV2Action(projectId, [preview.entries![0].target], false);
    expect(result).toMatchObject({ ok: true, count: 1 });
    expect(state.writes[0]).toEqual({ cover_title_bubble: expect.objectContaining({ layout_source: "SMART_V2", analysis_identity: visualImageKey(identity) }) });
    expect([state.panel.raw_image_url, state.panel.image_url, state.panel.scene, state.panel.image_prompt]).toEqual([
      before.raw_image_url, before.image_url, before.scene, before.image_prompt,
    ]);
  });
  test("approved Gemini origin uses the same cache/layout path", async () => {
    state.provider = "gemini";
    const preview = await (await import("../../lib/projects/smartLayoutV2")).prepareSmartV2PreviewAction(projectId, false);
    expect(preview.entries?.[0]).toMatchObject({ analysis: "CACHED", result: { status: "PASS" } });
    expect(analyze).not.toHaveBeenCalled();
  });
  test("legacy layout skips by default, manual overwrite is explicit", async () => {
    const { prepareSmartV2PreviewAction, visualCacheSummaryAction } = await import("../../lib/projects/smartLayoutV2");
    state.panel.cover_title_bubble = { x: 0.08, y: 0.04, width: 0.8, height: 0.18 };
    expect(await visualCacheSummaryAction(projectId)).toMatchObject({ ok: true, cached: 0, needed: 0 });
    expect(await visualCacheSummaryAction(projectId, true)).toMatchObject({ ok: true, cached: 1, needed: 0 });
    expect((await prepareSmartV2PreviewAction(projectId, false)).entries?.[0].result.status).toBe("SKIPPED_MANUAL");
    expect((await prepareSmartV2PreviewAction(projectId, true)).entries?.[0].result.status).toBe("PASS");
    expect(state.writes).toHaveLength(0);
  });
  test("analysis failure is isolated to review and no apply write", async () => {
    const { prepareSmartV2PreviewAction } = await import("../../lib/projects/smartLayoutV2");
    state.cache.clear(); analyze.mockRejectedValueOnce(Error("unavailable"));
    const preview = await prepareSmartV2PreviewAction(projectId, false);
    expect(preview.entries?.[0]).toMatchObject({ analysis: "ANALYSIS_FAILED", failureCode: "IMAGE_DOWNLOAD_FAILED",
      result: { status: "REVIEW_REQUIRED", reasonCode: "ANALYSIS_FAILED" } });
    expect(state.writes).toHaveLength(0);
  });
  test("stale or failed apply never changes existing image data", async () => {
    const { applySmartV2Action } = await import("../../lib/projects/smartLayoutV2");
    const target = { id: panelId, updatedAt: state.panel.updated_at, imageRowId, storagePath: path };
    expect((await applySmartV2Action(projectId, [{ ...target, updatedAt: "stale" }], false)).ok).toBe(false);
    expect(state.writes).toHaveLength(0);
    state.failed = true;
    expect((await applySmartV2Action(projectId, [target], false)).ok).toBe(false);
    expect(state.panel.raw_image_url).toBe(path);
    expect(state.panel.image_url).toBe("final/unchanged");
  });
});
