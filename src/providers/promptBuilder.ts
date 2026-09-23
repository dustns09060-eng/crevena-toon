import type { CharacterBible, SceneDefinition } from "../types.js";

export const NO_KOREAN_TEXT_RULE =
  "중요: 이미지 안에 한글이든 영어든 어떤 글자, 텍스트, 대사, 말풍선도 그리지 마세요. 그림(캐릭터와 배경)만 그립니다.";

export function buildScenePrompt(characters: CharacterBible[], scene: SceneDefinition): string {
  const characterBlocks = characters
    .map(
      (c) =>
        `[${c.display_name}] ${c.visual_prompt}\n제약: ${c.negative_constraints}`
    )
    .join("\n\n");

  return [
    `아래 캐릭터 설정을 반드시 지켜서 한 장의 정사각형(1:1) 인스타그램 카드뉴스 삽화를 그려주세요.`,
    characterBlocks,
    `장면 (${scene.title_ko}): ${scene.prompt}`,
    `첨부된 참조 이미지 속 인물들의 얼굴 특징과 분위기를 참고하되, 사진을 그대로 베끼지 말고 일관된 일러스트 스타일로 재해석하세요.`,
    NO_KOREAN_TEXT_RULE,
  ].join("\n\n");
}
