import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ToonPanel } from "../../src/db/types";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const userId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const characterId = "33333333-3333-4333-8333-333333333333";
const state = { panels: [] as ToonPanel[], writes: [] as Record<string, unknown>[], failAt: 0, status: "confirmed" };
vi.mock("../../lib/projects/service", () => ({
  getProject: async () => ({ id: projectId, user_id: userId, status: state.status, panel_count: state.panels.length }),
  getProjectPanels: async () => structuredClone(state.panels),
}));
vi.mock("../../lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
  from: () => {
    let values: Record<string, unknown> = {};
    const filters: Record<string, unknown> = {};
    const chain = {
      update(v: Record<string, unknown>) { values = v; return chain; },
      eq(k: string, v: unknown) { filters[k] = v; return chain; },
      select() { return chain; },
      then(resolve: (v: unknown) => void) {
        state.writes.push(values);
        if (state.failAt === state.writes.length) { resolve({ data: null, error: Error("db failure") }); return; }
        const row = state.panels.find((p) => p.id === filters.id && p.project_id === filters.project_id && p.updated_at === filters.updated_at);
        if (!row) { resolve({ data: [], error: null }); return; }
        Object.assign(row, values);
        row.updated_at = `2026-09-25T00:00:${String(state.writes.length).padStart(2, "0")}.000Z`;
        resolve({ data: [{ id: row.id, updated_at: row.updated_at }], error: null });
      },
    };
    return chain;
  },
}) }));

beforeEach(() => {
  state.panels = Array.from({ length: 11 }, (_, i) => ({
    id: `panel-${i + 1}`, project_id: projectId, panel_number: i + 1, panel_type: i ? "scene" : "cover",
    updated_at: "2026-09-24T00:00:00.000Z", cover_title: i ? null : "첫 화", cover_subtitle: i ? null : "EP.01",
    cover_title_bubble: null, dialogue: i ? [{ id: `44444444-4444-4444-8444-${String(i).padStart(12, "0")}`, character_id: characterId, text: `대사 ${i}`, bubble_type: "speech", bubble: null }] : [],
    narration: i ? `내레이션 ${i}` : null, narration_bubble: null, raw_image_url: `external/${i}`, image_url: `final/${i}`,
    scene: "기존 장면", expression: "기존 표정", image_prompt: "기존 프롬프트",
  })) as ToonPanel[];
  state.writes = []; state.failAt = 0; state.status = "confirmed";
});

const targets = () => state.panels.map((p) => ({ id: p.id, updatedAt: p.updated_at }));

describe("Smart Layout apply action", () => {
  test("read-only preview, 11 writes on explicit apply, images and story fields unchanged", async () => {
    const { smartLayoutAll } = await import("../../lib/editor/smartLayout");
    const { applySmartLayoutAction } = await import("../../lib/projects/smartLayout");
    const original = structuredClone(state.panels);
    expect(smartLayoutAll(state.panels.map((p) => ({ id: p.id, panelType: p.panel_type, dialogue: p.dialogue, narration: p.narration, narrationBubble: p.narration_bubble, coverTitle: p.cover_title, coverSubtitle: p.cover_subtitle, coverTitleBubble: p.cover_title_bubble, hasStoredLayout: false })))).toHaveLength(11);
    expect(state.writes).toHaveLength(0);
    expect(state.panels).toEqual(original);
    expect(await applySmartLayoutAction(projectId, targets(), false)).toMatchObject({ ok: true, count: 11 });
    expect(state.writes).toHaveLength(11);
    expect(state.writes[0]).toEqual({ cover_title_bubble: expect.any(Object) });
    expect(Object.keys(state.writes[1]).sort()).toEqual(["dialogue", "narration_bubble"]);
    state.panels.forEach((p, i) => {
      expect([p.raw_image_url, p.image_url, p.scene, p.expression, p.image_prompt]).toEqual([
        original[i].raw_image_url, original[i].image_url, original[i].scene, original[i].expression, original[i].image_prompt,
      ]);
    });
  });

  test("existing manual layout skips without consent, explicit overwrite works", async () => {
    const { applySmartLayoutAction } = await import("../../lib/projects/smartLayout");
    state.panels[0].cover_title_bubble = { x: 0.22, y: 0.2, width: 0.4, height: 0.18 };
    state.panels[1].dialogue[0].bubble = { x: 0.2, y: 0.3, width: 0.4, height: 0.12, tail_direction: "none" };
    expect(await applySmartLayoutAction(projectId, targets().slice(0, 2), false)).toMatchObject({ ok: true, count: 0 });
    expect(state.writes).toHaveLength(0);
    expect((await applySmartLayoutAction(projectId, targets().slice(0, 2), true)).count).toBe(2);
  });

  test("later DB error rolls back only touched layout, stale preview never writes", async () => {
    const { applySmartLayoutAction } = await import("../../lib/projects/smartLayout");
    const original = structuredClone(state.panels);
    const expected = targets();
    expected[0].updatedAt = "stale";
    expect((await applySmartLayoutAction(projectId, expected, true)).ok).toBe(false);
    expect(state.writes).toHaveLength(0);
    state.failAt = 5;
    expect((await applySmartLayoutAction(projectId, targets(), false)).ok).toBe(false);
    state.panels.forEach((p, i) => {
      const { updated_at: _time, ...current } = p;
      const { updated_at: _previous, ...before } = original[i];
      expect(current).toEqual(before);
    });
    expect(state.writes.every((v) => Object.keys(v).every((k) => ["dialogue", "narration_bubble", "cover_title_bubble"].includes(k)))).toBe(true);
  });

  test("20-panel project is supported and existing completed project is protected", async () => {
    const { applySmartLayoutAction } = await import("../../lib/projects/smartLayout");
    state.panels.push(...Array.from({ length: 9 }, (_, i) => ({ ...structuredClone(state.panels[1]), id: `extra-${i}`, panel_number: i + 12 })));
    expect(await applySmartLayoutAction(projectId, targets(), false)).toMatchObject({ ok: true, count: 20 });
    state.status = "completed";
    expect((await applySmartLayoutAction(projectId, targets(), true)).ok).toBe(false);
  });
});
