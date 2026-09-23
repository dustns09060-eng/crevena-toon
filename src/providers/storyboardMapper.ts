import type { StoryboardRaw } from "./storyboardSchema";

export interface StoryboardDraftDialogueLine {
  id: string;
  character_id: string;
  text: string;
}

export type StoryboardDraftPanelType = "cover" | "scene";

export interface StoryboardDraftPanel {
  panel_number: number;
  panel_type: StoryboardDraftPanelType;
  scene_description: string;
  character_ids: string[];
  expression: string;
  dialogue: StoryboardDraftDialogueLine[];
  narration: string | null;
  image_prompt: string;
  /** panel_type='cover'일 때만 값이 있다. */
  cover_title: string | null;
  cover_subtitle: string | null;
}

export interface StoryboardDraft {
  title: string;
  summary: string;
  /** panels[0]이 항상 표지(panel_type='cover', panel_number=1)이고, 이후가 본문(panel_number 2..N)이다. */
  panels: StoryboardDraftPanel[];
}

/**
 * AI는 실제 character_id(UUID)를 모르므로 CHARACTER_A/B/C... 식별자로
 * 캐릭터를 지칭한다(characterIdentifier.ts) — 검증 통과 후 이 함수가
 * 식별자를 실제 UUID로 치환해 DB에 저장 가능한 내부 구조로 바꾼다.
 * (예전에는 display_name 문자열로 매칭했는데, 유니코드 정규화 차이로
 * Production에서 실패하는 문제가 있어 ASCII 식별자 방식으로 바꿨다.)
 *
 * 019 — raw.cover(표지)와 raw.panels(본문)를 하나의 배열로 합친다.
 * 표지는 항상 panel_number=1을 차지하고, 본문은 2부터 이어진다 —
 * 이렇게 하나로 합쳐두면 저장/연속성 검증/에디터/최종 다운로드가
 * 전부 지금까지처럼 "균질한 panels 배열"로 동작할 수 있다.
 */
export function mapStoryboardRawToDraft(
  raw: StoryboardRaw,
  identifierToId: Map<string, string>
): StoryboardDraft {
  function resolveId(identifier: string): string {
    const id = identifierToId.get(identifier);
    if (!id) throw new Error(`캐릭터 식별자를 ID로 변환할 수 없습니다: ${identifier}`);
    return id;
  }

  const coverPanel: StoryboardDraftPanel = {
    panel_number: 1,
    panel_type: "cover",
    scene_description: raw.cover.scene_description,
    character_ids: raw.cover.characters.map(resolveId),
    expression: "",
    dialogue: [],
    narration: null,
    image_prompt: raw.cover.image_prompt,
    cover_title: raw.cover.cover_title,
    cover_subtitle: raw.cover.cover_subtitle,
  };

  const scenePanels: StoryboardDraftPanel[] = raw.panels.map((panel) => ({
    panel_number: panel.panel_number + 1,
    panel_type: "scene",
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
    cover_title: null,
    cover_subtitle: null,
  }));

  return {
    title: raw.title,
    summary: raw.summary,
    panels: [coverPanel, ...scenePanels],
  };
}
