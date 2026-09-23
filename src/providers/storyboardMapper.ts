import type { StoryboardRaw } from "./storyboardSchema";

export interface StoryboardDraftDialogueLine {
  id: string;
  character_id: string;
  text: string;
}

export interface StoryboardDraftPanel {
  panel_number: number;
  scene_description: string;
  character_ids: string[];
  expression: string;
  dialogue: StoryboardDraftDialogueLine[];
  narration: string | null;
  image_prompt: string;
}

export interface StoryboardDraft {
  title: string;
  summary: string;
  panels: StoryboardDraftPanel[];
}

/**
 * AI는 실제 character_id(UUID)를 모르므로 display_name으로 캐릭터를
 * 지칭한다 — 검증 통과 후 이 함수가 이름을 실제 UUID로 치환해
 * DB에 저장 가능한 내부 구조로 바꾼다.
 */
export function mapStoryboardRawToDraft(
  raw: StoryboardRaw,
  nameToId: Map<string, string>
): StoryboardDraft {
  function resolveId(name: string): string {
    const id = nameToId.get(name.trim().toLowerCase());
    if (!id) throw new Error(`캐릭터 이름을 ID로 변환할 수 없습니다: ${name}`);
    return id;
  }

  return {
    title: raw.title,
    summary: raw.summary,
    panels: raw.panels.map((panel) => ({
      panel_number: panel.panel_number,
      scene_description: panel.scene_description,
      character_ids: panel.characters.map(resolveId),
      expression: [...panel.expressions, ...panel.actions].join(", "),
      dialogue: panel.dialogue.map((line) => ({
        id: crypto.randomUUID(),
        character_id: resolveId(line.character),
        text: line.text,
      })),
      narration: panel.narration,
      image_prompt: panel.image_prompt,
    })),
  };
}

export function buildNameToIdMap(characters: { id: string; display_name: string }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of characters) {
    map.set(c.display_name.trim().toLowerCase(), c.id);
  }
  return map;
}
