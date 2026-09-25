import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ToonPanel } from "../../src/db/types";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const userId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const characterId = "33333333-3333-4333-8333-333333333333";
const state = { panels: [] as ToonPanel[], failAt: 0, writes: [] as Record<string, unknown>[], projectsRead: 0, images: [] as { panel_id: string; storage_path: string }[] };
const document = JSON.stringify({ cover: { title: "제목", subtitle: "부제" }, panels: Array.from({ length: 10 }, (_, i) => ({
  panel_number: i + 1, dialogue: [{ speaker: "엄마", text: `대사 ${i + 1}` }], narration: `내레이션 ${i + 1}`,
})) });

vi.mock("../../lib/projects/service", () => ({
  getProject: async () => { state.projectsRead++; return { id: projectId, user_id: userId, panel_count: state.panels.length, status: "confirmed" }; },
  getProjectPanels: async () => structuredClone(state.panels),
  getProjectCharacters: async () => [{ id: characterId, display_name: "엄마" }],
}));

function query(table: string) {
  let operation = "select";
  let values: Record<string, unknown> = {};
  const filters: Record<string, unknown> = {};
  const chain = {
    select(_columns: string) { return chain; },
    in(field: string, value: unknown[]) { filters[field] = value; return chain; },
    eq(field: string, value: unknown) { filters[field] = value; return chain; },
    update(input: Record<string, unknown>) { operation = "update"; values = input; return chain; },
    then(resolve: (value: unknown) => void) {
      if (table === "toon_panel_images") { resolve({ data: state.images, error: null }); return; }
      if (operation !== "update") { resolve({ data: [], error: null }); return; }
      state.writes.push(values);
      if (state.failAt === state.writes.length) { resolve({ data: null, error: Error("failure") }); return; }
      const target = state.panels.find((p) => p.id === filters.id && p.project_id === filters.project_id && p.updated_at === filters.updated_at);
      if (!target) { resolve({ data: [], error: null }); return; }
      Object.assign(target, values);
      target.updated_at = `2026-09-25T00:00:${String(state.writes.length).padStart(2, "0")}.000Z`;
      resolve({ data: [{ id: target.id, updated_at: target.updated_at }], error: null });
    },
  };
  return chain;
}

vi.mock("../../lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: userId } } }) }, from: query,
}) }));

beforeEach(() => {
  state.panels = Array.from({ length: 11 }, (_, i) => ({
    id: `panel-${i + 1}`, project_id: projectId, panel_number: i + 1, panel_type: i ? "scene" : "cover",
    updated_at: "2026-09-24T00:00:00.000Z", dialogue: [], narration: null, narration_bubble: null,
    cover_title: null, cover_subtitle: null, cover_title_bubble: null, scene: `scene ${i + 1}`, expression: "still", image_prompt: "still",
    raw_image_url: `${userId}/${projectId}/external/${i + 1}/original.png`, image_url: `${userId}/${projectId}/final/${i + 1}/existing.png`,
  })) as ToonPanel[];
  state.images = state.panels.map((p) => ({ panel_id: p.id, storage_path: p.raw_image_url! }));
  state.failAt = 0; state.writes = []; state.projectsRead = 0;
});

describe("dialogue import server action", () => {
  test("read-only preview, 11 image-safe updates, no AI calls", async () => {
    const { inspectDialogueImportAction, saveDialogueImportAction } = await import("../../lib/projects/dialogueImport");
    const before = structuredClone(state.panels);
    const inspection = await inspectDialogueImportAction(projectId, document);
    expect(inspection.ok).toBe(true);
    expect(state.writes).toHaveLength(0);
    expect(state.panels).toEqual(before);
    if (!inspection.ok) return;
    const result = await saveDialogueImportAction(projectId, document, inspection.fingerprint, false);
    expect(result).toMatchObject({ ok: true, count: 10 });
    expect(state.writes).toHaveLength(11);
    expect(state.writes[0]).toEqual({ cover_title: "제목", cover_subtitle: "부제", cover_title_bubble: expect.any(Object) });
    expect(Object.keys(state.writes[1]).sort()).toEqual(["dialogue", "narration", "narration_bubble"]);
    for (const [i, row] of state.panels.entries()) {
      expect(row.raw_image_url).toBe(before[i].raw_image_url);
      expect(row.image_url).toBe(before[i].image_url);
      expect([row.scene, row.expression, row.image_prompt]).toEqual([before[i].scene, before[i].expression, before[i].image_prompt]);
    }
    expect(state.images).toHaveLength(11);
    expect(state.panels[10].dialogue[0].text).toBe("대사 10");
  });

  test("existing cover, dialogue and narration require explicit confirmation", async () => {
    state.panels[0].cover_title = "기존 제목";
    state.panels[1].narration = "기존 내레이션";
    state.panels[1].dialogue = [{ id: characterId, character_id: characterId, text: "기존 대사", bubble_type: "speech", bubble: null }];
    const { inspectDialogueImportAction, saveDialogueImportAction } = await import("../../lib/projects/dialogueImport");
    const inspection = await inspectDialogueImportAction(projectId, document);
    if (!inspection.ok) throw Error("fixture");
    expect(inspection.conflicts[0].coverTitle).toBe(true);
    expect(inspection.conflicts[1]).toMatchObject({ dialogue: true, narration: true });
    expect((await saveDialogueImportAction(projectId, document, inspection.fingerprint, false)).ok).toBe(false);
    expect(state.writes).toHaveLength(0);
    expect((await saveDialogueImportAction(projectId, document, inspection.fingerprint, true)).ok).toBe(true);
  });

  test("failure on a later panel compensates only text fields and preserves all images", async () => {
    const { inspectDialogueImportAction, saveDialogueImportAction } = await import("../../lib/projects/dialogueImport");
    const before = structuredClone(state.panels);
    const inspection = await inspectDialogueImportAction(projectId, document);
    if (!inspection.ok) throw Error("fixture");
    state.failAt = 5;
    const result = await saveDialogueImportAction(projectId, document, inspection.fingerprint, false);
    expect(result.ok).toBe(false);
    for (const [i, row] of state.panels.entries()) {
      const { updated_at: _time, ...current } = row;
      const { updated_at: _oldTime, ...previous } = before[i];
      expect(current).toEqual(previous);
    }
    expect(state.images).toHaveLength(11);
    expect(state.writes.every((p) => Object.keys(p).every((key) => ["cover_title", "cover_subtitle", "cover_title_bubble", "dialogue", "narration", "narration_bubble"].includes(key)))).toBe(true);
  });

  test("stale preview is rejected and non-external project never writes", async () => {
    const { inspectDialogueImportAction, saveDialogueImportAction } = await import("../../lib/projects/dialogueImport");
    const inspection = await inspectDialogueImportAction(projectId, document);
    if (!inspection.ok) throw Error("fixture");
    state.panels[1].narration = "다른 편집";
    expect((await saveDialogueImportAction(projectId, document, inspection.fingerprint, true)).ok).toBe(false);
    state.panels[1].narration = null;
    state.images = [];
    expect((await saveDialogueImportAction(projectId, document, inspection.fingerprint, true)).ok).toBe(false);
    expect(state.writes).toHaveLength(0);
  });

  test("existing 20-panel non-external project remains unchanged", async () => {
    state.panels.push(...Array.from({ length: 9 }, (_, i) => ({
      ...structuredClone(state.panels[1]), id: `legacy-${i}`, panel_number: i + 12,
      raw_image_url: `${userId}/${projectId}/raw/${i + 12}/approved.png`,
    })));
    const before = structuredClone(state.panels);
    const { inspectDialogueImportAction } = await import("../../lib/projects/dialogueImport");
    const result = await inspectDialogueImportAction(projectId, document);
    expect(result.ok).toBe(false);
    expect(state.panels).toEqual(before);
    expect(state.writes).toHaveLength(0);
  });

  test("an external 20-panel project uses its actual range without hardcoded ten", async () => {
    const extra = Array.from({ length: 9 }, (_, i) => ({
      ...structuredClone(state.panels[1]), id: `extra-${i}`, panel_number: i + 12,
      raw_image_url: `${userId}/${projectId}/external/${i + 12}/original.png`,
    }));
    state.panels.push(...extra);
    state.images.push(...extra.map((p) => ({ panel_id: p.id, storage_path: p.raw_image_url })));
    const { inspectDialogueImportAction, saveDialogueImportAction } = await import("../../lib/projects/dialogueImport");
    const payload = JSON.stringify({ cover: { title: "20장", subtitle: "" }, panels: [{ panel_number: 19, dialogue: [], narration: "끝" }] });
    const inspection = await inspectDialogueImportAction(projectId, payload);
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;
    expect((await saveDialogueImportAction(projectId, payload, inspection.fingerprint, false)).ok).toBe(true);
    expect(state.panels[19].narration).toBe("끝");
    expect(state.panels[1].narration).toBeNull();
    expect(state.writes).toHaveLength(2);
  });
});
