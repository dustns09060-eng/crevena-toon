import { describe, expect, test } from "vitest";
import { canArrangeV2, canAutomaticallyArrange, panelLayoutSource, readLayoutSource } from "../../lib/editor/layoutProvenance";
import { buildImportUpdates, parseDialogueImport } from "../../lib/projects/dialogueImportUtils";
import { smartLayoutPanel, type SmartPanel } from "../../lib/editor/smartLayout";
import { getDefaultBubbleForIndex } from "../../lib/editor/bubbleLayout";
import type { ToonPanel } from "../../src/db/types";

describe("layout source", () => {
  test.each(["IMPORT_DEFAULT", "SMART_V1", "SMART_V2", "MANUAL"] as const)("reads %s", (source) => {
    expect(readLayoutSource({ layout_source: source })).toBe(source);
  });
  test("legacy and manual are protected, import and v1 are eligible", () => {
    expect(readLayoutSource(getDefaultBubbleForIndex(0))).toBe("LEGACY");
    expect(canAutomaticallyArrange("LEGACY")).toBe(false);
    expect(canAutomaticallyArrange("MANUAL")).toBe(false);
    expect(canAutomaticallyArrange("LEGACY", true)).toBe(true);
    expect(canAutomaticallyArrange("IMPORT_DEFAULT")).toBe(true);
    expect(canAutomaticallyArrange("SMART_V1")).toBe(true);
    expect(canAutomaticallyArrange("SMART_V2")).toBe(false);
  });
  test("mixed provenance never silently overwrites a manual narration", () => {
    expect(panelLayoutSource({ panelType: "scene", coverTitleBubble: null,
      dialogue: [{ id: "1", character_id: "2", text: "hi", bubble_type: "speech", bubble: { ...getDefaultBubbleForIndex(0), layout_source: "IMPORT_DEFAULT" } }],
      narrationBubble: { x: 0.1, y: 0.8, width: 0.8, height: 0.1, layout_source: "MANUAL" } })).toBe("MIXED");
    expect(canAutomaticallyArrange("MIXED")).toBe(false);
  });
  test("SMART_V2 keeps identical image but new image identity becomes eligible", () => {
    const panel = { panelType: "cover" as const, coverTitleBubble: { x: 0.1, y: 0.1, width: 0.5, height: 0.2,
      layout_source: "SMART_V2" as const, analysis_identity: "old-key" }, dialogue: [], narrationBubble: null };
    expect(canArrangeV2(panel, "old-key")).toBe(false);
    expect(canArrangeV2(panel, "new-key")).toBe(true);
  });
  test("v1 new dialogue/narration/cover all receive SMART_V1", () => {
    const base: SmartPanel = { id: "p", panelType: "scene", dialogue: [{ id: "d", character_id: "c", text: "안녕", bubble_type: "speech", bubble: null }],
      narration: "하루", narrationBubble: null, coverTitle: null, coverSubtitle: null, coverTitleBubble: null, hasStoredLayout: false };
    const scene = smartLayoutPanel(base).panel;
    expect(scene.dialogue[0].bubble?.layout_source).toBe("SMART_V1");
    expect(scene.narrationBubble?.layout_source).toBe("SMART_V1");
    expect(smartLayoutPanel({ ...base, panelType: "cover", coverTitle: "제목" }).panel.coverTitleBubble?.layout_source).toBe("SMART_V1");
  });
  test("old JSON import produces IMPORT_DEFAULT for all new layouts", () => {
    const parsed = parseDialogueImport(JSON.stringify({ cover: { title: "제목", subtitle: "EP.01" }, panels: [{ panel_number: 1,
      dialogue: [{ speaker: "엄마", text: "안녕" }], narration: "하루" }] }), 2);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const panels = [{ panel_number: 1, panel_type: "cover", cover_title_bubble: null }, { panel_number: 2, panel_type: "scene", narration_bubble: null }] as ToonPanel[];
    const updates = buildImportUpdates(parsed.value, panels, [{ id: "11111111-1111-4111-8111-111111111111", display_name: "엄마" }]);
    expect((updates[0].values as { cover_title_bubble: { layout_source: string } }).cover_title_bubble.layout_source).toBe("IMPORT_DEFAULT");
    const values = updates[1].values as { dialogue: { bubble: { layout_source: string } }[]; narration_bubble: { layout_source: string } };
    expect(values.dialogue[0].bubble.layout_source).toBe("IMPORT_DEFAULT");
    expect(values.narration_bubble.layout_source).toBe("IMPORT_DEFAULT");
  });
});
