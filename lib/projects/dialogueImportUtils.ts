import { z } from "zod";
import { getDefaultBubbleForIndex, getDefaultCoverTitleBubble, getDefaultNarrationBubble } from "../editor/bubbleLayout";
import { validateCoverTitleBubble, validateDialogueCharacterIds, validateNarrationBubble, validateToonDialogue } from "../../src/db/validation";
import type { ToonDialogueItem, ToonPanel } from "../../src/db/types";
import { ToonBubbleStyleSchema, ToonDialogueEmotionSchema, ToonNarrationPresetSchema } from "../../src/db/validation";

export const MAX_DIALOGUE_IMPORT_BYTES = 1024 * 1024;

export async function readDialogueImportFile(file: Pick<File, "name" | "size" | "text">): Promise<string> {
  if (!/\.json$/i.test(file.name) || file.size > MAX_DIALOGUE_IMPORT_BYTES || file.size <= 0) {
    throw Error("1MB 이하의 .json 파일을 선택해주세요.");
  }
  const text = await file.text();
  if (new TextEncoder().encode(text).length > MAX_DIALOGUE_IMPORT_BYTES) throw Error("JSON은 1MB 이하이어야 합니다.");
  return text;
}

const schema = z.object({
  series_title: z.string().max(300).optional(),
  episode: z.string().max(100).optional(),
  cover: z.object({ title: z.string().max(2000), subtitle: z.string().max(2000) }).strict(),
  panels: z.array(z.object({
    panel_number: z.number().int(),
    dialogue: z.array(z.object({ speaker: z.string().trim().min(1).max(200), text: z.string().trim().min(1).max(5000), emotion: ToonDialogueEmotionSchema.optional(), bubble_style: ToonBubbleStyleSchema.optional() }).strict()).max(30),
    narration: z.union([z.string().max(10000), z.null(), z.object({ text: z.string().max(10000), style: ToonNarrationPresetSchema.optional() }).strict()]),
  }).strict()).min(1).max(19),
}).strict();

export type DialogueImportDocument = z.infer<typeof schema>;
export type ImportCharacter = { id: string; display_name: string };
export type ImportConflict = { panelNumber: number; dialogue: boolean; narration: boolean; coverTitle: boolean; coverSubtitle: boolean };

export function parseDialogueImport(json: string, panelCount: number): { ok: true; value: DialogueImportDocument } | { ok: false; message: string } {
  if (new TextEncoder().encode(json).length > MAX_DIALOGUE_IMPORT_BYTES) return { ok: false, message: "JSON은 1MB 이하이어야 합니다." };
  let value: unknown;
  try { value = JSON.parse(json); } catch { return { ok: false, message: "JSON 문법이 올바르지 않습니다." }; }
  const parsed = schema.safeParse(value);
  if (!parsed.success) return { ok: false, message: `JSON 형식이 올바르지 않습니다: ${parsed.error.issues[0]?.path.join(".") || "root"}` };
  const numbers = parsed.data.panels.map((p) => p.panel_number);
  if (new Set(numbers).size !== numbers.length) return { ok: false, message: "panel_number가 중복되었습니다." };
  if (numbers.some((n) => n < 1 || n >= panelCount)) return { ok: false, message: `본문 panel_number는 1~${panelCount - 1}만 사용할 수 있습니다.` };
  return { ok: true, value: parsed.data };
}

/** Import number 1 maps to DB panel_number 2; absent numbers remain untouched. */
export function importConflicts(doc: DialogueImportDocument, panels: ToonPanel[]): ImportConflict[] {
  const cover = panels.find((p) => p.panel_number === 1)!;
  return [
    { panelNumber: 0, dialogue: false, narration: false, coverTitle: Boolean(cover.cover_title), coverSubtitle: Boolean(cover.cover_subtitle) },
    ...doc.panels.map(({ panel_number }) => {
      const current = panels.find((p) => p.panel_number === panel_number + 1)!;
      return { panelNumber: panel_number, dialogue: current.dialogue.length > 0, narration: Boolean(current.narration), coverTitle: false, coverSubtitle: false };
    }),
  ];
}

export function validateImportSpeakers(doc: DialogueImportDocument, characters: ImportCharacter[]): string | null {
  for (const panel of doc.panels) for (const item of panel.dialogue) {
    if (characters.filter((c) => c.display_name === item.speaker).length !== 1) {
      return `Panel ${panel.panel_number}: 화자 '${item.speaker}'와 정확히 일치하는 프로젝트 캐릭터가 한 명 필요합니다.`;
    }
  }
  return null;
}

export function buildImportUpdates(doc: DialogueImportDocument, panels: ToonPanel[], characters: ImportCharacter[], makeId: () => string = () => crypto.randomUUID()) {
  const cover = panels.find((p) => p.panel_number === 1)!;
  const coverValues = {
    cover_title: doc.cover.title || null,
    cover_subtitle: doc.cover.subtitle || null,
    cover_title_bubble: doc.cover.title ? (cover.cover_title_bubble ?? { ...getDefaultCoverTitleBubble(), layout_source: "IMPORT_DEFAULT" as const }) : null,
  };
  if (!validateCoverTitleBubble(coverValues.cover_title_bubble).valid) throw Error("표지 배치가 올바르지 않습니다.");
  return [
    { panel: cover, values: coverValues },
    ...doc.panels.map((incoming) => {
      const panel = panels.find((p) => p.panel_number === incoming.panel_number + 1)!;
      const dialogue: ToonDialogueItem[] = incoming.dialogue.map((d, i) => ({
        id: makeId(), character_id: characters.find((c) => c.display_name === d.speaker)!.id,
        text: d.text, bubble_type: "speech", bubble: { ...getDefaultBubbleForIndex(i), layout_source: "IMPORT_DEFAULT", style: d.bubble_style ?? (d.emotion === "panic" || d.emotion === "surprised" ? "shout" : d.emotion === "warm" ? "soft" : "round") },
        ...(d.emotion ? { emotion: d.emotion } : {}),
      }));
      const narration = (typeof incoming.narration === "object" && incoming.narration !== null ? incoming.narration.text : incoming.narration)?.trim() || null;
      const narration_bubble = narration ? { ...(panel.narration_bubble ?? { ...getDefaultNarrationBubble(), layout_source: "IMPORT_DEFAULT" as const }), ...(typeof incoming.narration === "object" && incoming.narration !== null && incoming.narration.style ? { preset: incoming.narration.style } : {}) } : null;
      if (!validateToonDialogue(dialogue).valid || !validateDialogueCharacterIds(dialogue, characters.map((c) => c.id)).valid
        || !validateNarrationBubble(narration_bubble).valid) throw Error("대사 또는 내레이션 배치가 올바르지 않습니다.");
      return { panel, values: { dialogue, narration, narration_bubble } };
    }),
  ];
}

export function originalImportValues(panel: ToonPanel): Record<string, unknown> {
  return panel.panel_type === "cover"
    ? { cover_title: panel.cover_title, cover_subtitle: panel.cover_subtitle, cover_title_bubble: panel.cover_title_bubble }
    : { dialogue: panel.dialogue, narration: panel.narration, narration_bubble: panel.narration_bubble };
}
