import type { CharacterBibleForPrompt } from "./characterSheetPromptBuilder";
import { buildNegativeImageConstraintsClause } from "./imageNegativeConstraints";

/**
 * 최종 컷 이미지 prompt 빌더.
 *
 * STEP 6 §5 원칙: 스토리보드 AI(STEP 5)가 image_prompt에 실수로 캐릭터
 * 외형을 잘못 적었더라도(예: "brown hair mother"), 이 함수는 그 값을
 * 신뢰하지 않는다. 캐릭터의 고정 외형은 오직 Character Bible(사용자가
 * STEP 3에서 저장한 값)에서만 가져온다 — Character Bible이
 * source of truth다.
 *
 * 이 함수는 의도적으로 dialogue/narration을 파라미터로 받지 않는다
 * (타입 자체에 없음) — 이미지 생성 모델에게 대사가 무엇인지 알려줄
 * 필요가 없기 때문이다(STEP 6 §7).
 */

export interface PanelCharacterContext {
  display_name: string;
  characterBible: CharacterBibleForPrompt;
}

export interface BuildPanelImagePromptInput {
  /** STEP 5 storyboard의 panel.scene(장면 묘사) */
  sceneDescription: string;
  /** STEP 5 storyboard의 panel.expression(표정/행동, 이미 합쳐진 문자열) */
  expression: string;
  /** STEP 5 storyboard의 panel.image_prompt(카메라 구도 등, dialogue 없음) */
  imagePrompt: string;
  characters: PanelCharacterContext[];
  style: string;
  /** 예: "1:1" — 향후 4:5 등 다른 비율을 추가할 수 있도록 설정값으로 분리 */
  aspectRatio: string;
  /**
   * 표지 전용 추가 지시. 값이 있으면 "이 장면은 에피소드 표지다"라는
   * 맥락과 제목 여백/텍스트 금지 지시를 덧붙인다. 본문 컷은 이 값을
   * 넘기지 않는다(undefined) — 기존 호출부는 전혀 변경할 필요가 없다.
   */
  coverNote?: string;
}

function buildCharacterBlock(index: number, ctx: PanelCharacterContext): string {
  const b = ctx.characterBible;
  const lines = [
    `CHARACTER ${String.fromCharCode(65 + index)} — ${ctx.display_name}`,
    `Hairstyle: ${b.hairstyle}`,
    `Hair color: ${b.hair_color}`,
    `Face features: ${b.face_features}`,
    `Body type: ${b.body_type}`,
    `Outfit: ${b.representative_outfit}`,
  ];
  if (b.distinctive_features) lines.push(`Distinctive features: ${b.distinctive_features}`);
  lines.push(b.visual_prompt);
  if (b.negative_constraints.length > 0) {
    lines.push(`Constraints for this character: ${b.negative_constraints.join("; ")}.`);
  }
  return lines.join("\n");
}

/**
 * 참조 이미지(각 캐릭터의 승인된 Character Sheet)가 실제 API 요청에서
 * "CHARACTER A/B/C" 순서와 동일한 순서로 첨부된다는 것을 모델에게
 * 명시적으로 알려준다. 이전까지는 텍스트 라벨과 이미지 배열 순서가
 * 암묵적으로만 일치해 identity가 섞일 위험이 있었다(조사 결과) — 이
 * 문장이 그 바인딩을 명확히 한다. 호출부(panelImages.ts)는
 * referenceImages 배열을 항상 이 순서(캐릭터 블록 순서)와 동일하게
 * 만들어야 한다.
 */
function buildReferenceImageMappingClause(count: number): string {
  const lines = ["REFERENCE IMAGE MAPPING:"];
  for (let i = 0; i < count; i++) {
    lines.push(`Reference image ${i + 1} = CHARACTER ${String.fromCharCode(65 + i)}`);
  }
  lines.push(
    "Each character must keep only their own reference identity (face, hairstyle, hair color, body type) " +
      "and must not borrow or blend facial/hair/body features from any other character's reference image."
  );
  return lines.join("\n");
}

export function buildPanelImagePrompt(input: BuildPanelImagePromptInput): string {
  const lines: string[] = [
    `Generate a single Instagram daily-life comic panel illustration, aspect ratio ${input.aspectRatio}.`,
    input.style,
  ];

  if (input.coverNote) {
    lines.push("", input.coverNote);
  }

  input.characters.forEach((ctx, i) => {
    lines.push("", buildCharacterBlock(i, ctx));
  });

  if (input.characters.length > 1) {
    lines.push(
      "",
      "Do not mix up the characters above — each character's face, hairstyle, hair color, age, and outfit " +
        "must stay exactly as described for that character and must not blend with any other character in this scene.",
      "",
      buildReferenceImageMappingClause(input.characters.length)
    );
  }

  lines.push(
    "",
    `SCENE: ${input.sceneDescription}`,
    `EXPRESSION/ACTION: ${input.expression}`,
    `COMPOSITION: ${input.imagePrompt}`,
    "",
    "Leave clean, uncluttered visual space (for example near the top of the frame or beside a character's head) " +
      "where a speech bubble may later be overlaid by separate software — but do not draw any speech bubble " +
      "shape, tail, or outline yourself.",
    "",
    buildNegativeImageConstraintsClause()
  );

  return lines.join("\n");
}

/** 표지 전용 안내문 — buildPanelImagePrompt의 coverNote로 전달한다. */
export const COVER_COMPOSITION_NOTE =
  "This is the COVER image for the whole episode (Instagram feed thumbnail). It must represent the entire " +
  "episode at a glance, clearly show the main character(s), and use an eye-catching composition. Leave clean " +
  "empty space near the top (or another natural area) for a title that will be added later as a separate text " +
  "overlay — but do not draw any title text, letters, or logo yourself; the image itself must contain no text.";
