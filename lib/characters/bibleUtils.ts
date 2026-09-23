import type { CharacterBibleForPrompt } from "../../src/providers/characterSheetPromptBuilder";
import type { ToonCharacter } from "../../src/db/types";

/**
 * 순수 유틸 함수 모음 — "use server" 파일(characterSheet.ts, panelImages.ts)
 * 양쪽에서 재사용한다. Next.js Server Action 파일은 모든 export가
 * async 함수여야 하므로, 동기 함수는 반드시 이렇게 별도 파일로
 * 분리해야 한다.
 */

export function characterHasSavedBible(character: ToonCharacter): boolean {
  return Boolean(character.hairstyle && character.hair_color && character.face_features && character.body_type);
}

export function toBibleForPrompt(character: ToonCharacter): CharacterBibleForPrompt {
  return {
    hairstyle: character.hairstyle!,
    hair_color: character.hair_color!,
    face_features: character.face_features!,
    body_type: character.body_type!,
    representative_outfit: character.representative_outfit ?? "",
    distinctive_features: character.distinctive_features,
    visual_prompt: character.visual_prompt,
    negative_constraints: character.negative_constraints ?? [],
  };
}
