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

export function buildPanelImagePrompt(input: BuildPanelImagePromptInput): string {
  const lines: string[] = [
    `Generate a single Instagram daily-life comic panel illustration, aspect ratio ${input.aspectRatio}.`,
    input.style,
  ];

  input.characters.forEach((ctx, i) => {
    lines.push("", buildCharacterBlock(i, ctx));
  });

  if (input.characters.length > 1) {
    lines.push(
      "",
      "Do not mix up the characters above — each character's face, hairstyle, hair color, age, and outfit " +
        "must stay exactly as described for that character and must not blend with any other character in this scene."
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
