/**
 * Character Sheet 생성용 프롬프트 빌더.
 *
 * STEP 4 §0 원칙: AI가 여기서 캐릭터 특징을 다시 "분석/결정"하지
 * 않는다 — 사용자가 STEP 3에서 저장한 Character Bible 값을 있는
 * 그대로 프롬프트에 반영하는 것이 유일한 역할이다. AI 분석 당시
 * 값(hair_color=dark brown)과 사용자가 이후 수정한 값(black)이
 * 다르면, 이 빌더는 반드시 사용자가 저장한 최신 값(black)만
 * 받아서 사용한다 — 이 함수 자체는 별도 결정을 하지 않는다.
 */

export interface CharacterBibleForPrompt {
  hairstyle: string;
  hair_color: string;
  face_features: string;
  body_type: string;
  representative_outfit: string;
  distinctive_features: string | null;
  visual_prompt: string;
  negative_constraints: string[];
}

export interface BuildCharacterSheetPromptInput {
  characterBible: CharacterBibleForPrompt;
  style: string;
  referenceCount: number;
}

const CONSISTENCY_RULES = [
  "same character in every pose",
  "consistent facial features",
  "consistent hairstyle",
  "consistent hair color",
  "consistent outfit",
  "clean character reference sheet",
  "no background scene",
  "no unrelated props",
  "no speech bubbles",
  "no Korean text",
  "no text labels",
  "no watermark",
];

export function buildCharacterSheetPrompt(input: BuildCharacterSheetPromptInput): string {
  const { characterBible, style, referenceCount } = input;

  const lines: string[] = [
    "Generate a single character reference sheet image: one image containing multiple poses and " +
      "expressions of the SAME character, arranged in a clean grid layout.",
    style,
    `Hairstyle (must match exactly): ${characterBible.hairstyle}`,
    `Hair color (must match exactly): ${characterBible.hair_color}`,
    `Face features: ${characterBible.face_features}`,
    `Body type: ${characterBible.body_type}`,
    `Representative outfit (must match exactly): ${characterBible.representative_outfit}`,
  ];

  if (characterBible.distinctive_features) {
    lines.push(`Distinctive features: ${characterBible.distinctive_features}`);
  }

  lines.push(characterBible.visual_prompt);

  lines.push(
    "Layout: include front view, 3/4 view, side view, a smiling expression, a surprised expression, " +
      "and an upset/pouting expression, each clearly separated within the single sheet. Upper body or " +
      "full body framing, no scene background behind each pose."
  );

  if (referenceCount > 0) {
    lines.push(
      `${referenceCount} reference photo(s) of the real person are attached — use them only to match this ` +
        "person's real visual identity (face shape, hair, etc). Do not copy their background, clothing props, " +
        "or any other people visible in those photos."
    );
  }

  lines.push("Rules: " + CONSISTENCY_RULES.join(", ") + ".");

  if (characterBible.negative_constraints.length > 0) {
    lines.push("Character-specific constraints: " + characterBible.negative_constraints.join("; ") + ".");
  }

  return lines.join("\n");
}
