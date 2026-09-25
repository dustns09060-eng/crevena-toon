import { describe, expect, test } from "vitest";
import { buildImportUpdates, importConflicts, parseDialogueImport, readDialogueImportFile, validateImportSpeakers } from "../../lib/projects/dialogueImportUtils";
import type { ToonPanel } from "../../src/db/types";

const character = { id: "11111111-1111-4111-8111-111111111111", display_name: "엄마" };
const panels = Array.from({ length: 11 }, (_, i) => ({
  id: `p${i}`, panel_number: i + 1, panel_type: i ? "scene" : "cover",
  dialogue: [], narration: null, narration_bubble: null, cover_title: null, cover_subtitle: null, cover_title_bubble: null,
  raw_image_url: `external/${i}`, image_url: `final/${i}`, scene: "original scene", expression: "original expression", image_prompt: "original prompt",
})) as unknown as ToonPanel[];
const doc = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  series_title: "우리 이야기", episode: "EP.01", cover: { title: "표지", subtitle: "부제" },
  panels: [{ panel_number: 1, dialogue: [{ speaker: "엄마", text: "안녕" }, { speaker: "엄마", text: "좋은 아침" }], narration: "시작" }], ...overrides,
});

describe("external dialogue JSON", () => {
  test("optional emotions, explicit styles and styled narration retain legacy input compatibility", () => {
    const styled = parseDialogueImport(doc({ panels: [{ panel_number: 1, dialogue: [
      { speaker: "엄마", text: "무서워!", emotion: "panic" },
      { speaker: "엄마", text: "조용히", bubble_style: "whisper", emotion: "warm" },
      { speaker: "엄마", text: "명시 우선", bubble_style: "round", emotion: "panic" },
    ], narration: { text: "따뜻한 하루", style: "soft" } }] }), 11);
    expect(styled.ok).toBe(true);
    if (!styled.ok) return;
    const values = buildImportUpdates(styled.value, panels, [character])[1].values as { dialogue: Array<{ bubble: { style: string }; emotion?: string }>; narration: string; narration_bubble: { preset: string } };
    expect(values.dialogue.map((d) => d.bubble.style)).toEqual(["shout", "whisper", "round"]);
    expect(values.dialogue[0].emotion).toBe("panic");
    expect(values.narration).toBe("따뜻한 하루");
    expect(values.narration_bubble.preset).toBe("soft");
    expect(parseDialogueImport(doc({ panels: [{ panel_number: 1, dialogue: [{ speaker: "엄마", text: "안녕", emotion: "unknown" }], narration: null }] }), 11).ok).toBe(false);
  });
  test("file import reads the same JSON as pasted text, rejecting bad extensions and sizes", async () => {
    const input = { name: "episode.json", size: 200, text: async () => doc() };
    expect(parseDialogueImport(await readDialogueImportFile(input), 11)).toEqual(parseDialogueImport(doc(), 11));
    await expect(readDialogueImportFile({ ...input, name: "episode.png" })).rejects.toThrow(".json");
    await expect(readDialogueImportFile({ ...input, size: 1024 * 1024 + 1 })).rejects.toThrow("1MB");
  });
  test("valid 11-slide JSON preserves cover, metadata and both dialogue lines", () => {
    const parsed = parseDialogueImport(doc(), 11);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.cover).toEqual({ title: "표지", subtitle: "부제" });
    expect(parsed.value.series_title).toBe("우리 이야기");
    expect(validateImportSpeakers(parsed.value, [character])).toBeNull();
    const updates = buildImportUpdates(parsed.value, panels, [character], () => "22222222-2222-4222-8222-222222222222");
    expect(updates).toHaveLength(2);
    const cover = updates[0].values as { cover_title: string; cover_subtitle: string; cover_title_bubble: unknown };
    expect([cover.cover_title, cover.cover_subtitle, cover.cover_title_bubble]).toEqual(["표지", "부제", expect.any(Object)]);
    const scene = updates[1].values as { dialogue: Array<{ character_id: string; bubble_type: string; bubble: { tail_enabled?: boolean } }>; narration: string; narration_bubble: unknown };
    expect(scene.dialogue).toHaveLength(2);
    expect(scene.dialogue[0].character_id).toBe(character.id);
    expect(scene.dialogue[0].bubble_type).toBe("speech");
    expect(scene.dialogue[0].bubble?.tail_enabled).toBeUndefined();
    expect(scene.narration).toBe("시작");
    expect(scene.narration_bubble).toEqual(expect.any(Object));
    expect(updates[1].panel.panel_number).toBe(2);
  });

  test.each([null, ""])('empty narration %s becomes null and does not place narration', (narration) => {
    const parsed = parseDialogueImport(doc({ panels: [{ panel_number: 1, dialogue: [], narration }] }), 11);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const scene = buildImportUpdates(parsed.value, panels, [character])[1].values as { dialogue: unknown[]; narration: null; narration_bubble: null };
    expect(scene).toEqual({ dialogue: [], narration: null, narration_bubble: null });
  });

  test("partial panels are allowed; missing panels are unchanged", () => {
    const parsed = parseDialogueImport(doc({ panels: [{ panel_number: 10, dialogue: [], narration: null }] }), 11);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(buildImportUpdates(parsed.value, panels, [character]).map((u) => u.panel.panel_number)).toEqual([1, 11]);
  });

  test("actual 20-panel project permits Panel 19, rejects Panel 20", () => {
    const json = doc({ panels: [{ panel_number: 19, dialogue: [], narration: null }] });
    expect(parseDialogueImport(json, 20).ok).toBe(true);
    expect(parseDialogueImport(doc({ panels: [{ panel_number: 20, dialogue: [], narration: null }] }), 20).ok).toBe(false);
  });

  test.each([
    ['duplicate numbers', doc({ panels: Array.from({ length: 2 }, () => ({ panel_number: 1, dialogue: [], narration: null })) })],
    ['zero', doc({ panels: [{ panel_number: 0, dialogue: [], narration: null }] })],
    ['11 scene', doc({ panels: [{ panel_number: 11, dialogue: [], narration: null }] })],
    ['invalid type', doc({ panels: [{ panel_number: "1", dialogue: [], narration: null }] })],
    ['missing fields', doc({ panels: [{ panel_number: 1 }] })],
    ['bad JSON', '{"cover":'],
    ['too big', doc({ episode: "x".repeat(1024 * 1024) })],
  ])('%s is rejected', (_label, json) => expect(parseDialogueImport(json, 11).ok).toBe(false));

  test("unlinked and ambiguous character names are rejected", () => {
    const parsed = parseDialogueImport(doc(), 11);
    if (!parsed.ok) throw Error("fixture");
    expect(validateImportSpeakers(parsed.value, [])).toContain("엄마");
    expect(validateImportSpeakers(parsed.value, [character, { ...character, id: "second" }])).toContain("엄마");
  });

  test("existing text is flagged and existing layout retained where possible", () => {
    const current = panels.map((p) => ({ ...p }));
    current[0].cover_title = "옛 제목"; current[0].cover_subtitle = "옛 부제";
    current[1].dialogue = [{ id: character.id, character_id: character.id, text: "옛 대사", bubble_type: "speech", bubble: null }];
    current[1].narration = "옛 내레이션";
    current[1].narration_bubble = { x: 0.1, y: 0.8, width: 0.8, height: 0.1 };
    const parsed = parseDialogueImport(doc(), 11);
    if (!parsed.ok) throw Error("fixture");
    expect(importConflicts(parsed.value, current)).toEqual([
      { panelNumber: 0, dialogue: false, narration: false, coverTitle: true, coverSubtitle: true },
      { panelNumber: 1, dialogue: true, narration: true, coverTitle: false, coverSubtitle: false },
    ]);
    const scene = buildImportUpdates(parsed.value, current, [character])[1].values as { narration_bubble: unknown };
    expect(scene.narration_bubble).toEqual(current[1].narration_bubble);
  });
});
