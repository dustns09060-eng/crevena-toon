import { buildNegativeImageConstraintsClause } from "./imageNegativeConstraints";

/**
 * 기존 candidate 이미지를 "부분 수정"할 때 쓰는 전용 prompt builder.
 *
 * buildPanelImagePrompt(일반 생성)와 의도적으로 완전히 분리한다 —
 * 저 함수는 scene/image_prompt/Location Bible을 처음부터 다시
 * 해석해서 "재생성"하는 게 목적이고, 이 함수는 반대로 "이미 있는
 * 이미지를 기준으로 최소한만 바꾸는" 게 목적이다. 두 목적을 하나의
 * 함수에 옵션으로 얹으면 "재생성" 경로가 의도치 않게 "수정" 방향으로
 * 새거나 그 반대가 될 위험이 있어 처음부터 별도 파일로 둔다.
 */

export interface PanelImageEditReferenceCharacter {
  display_name: string;
}

export interface BuildPanelImageEditPromptInput {
  /** 사용자가 입력한 자연어 수정 요청(1개, 자유 텍스트). */
  editInstruction: string;
  /**
   * SOURCE PANEL IMAGE 바로 뒤에 이어 붙는 Character Sheet 참조
   * 이미지들의 순서와 반드시 1:1로 대응해야 한다(deterministic
   * mapping) — 호출부는 referenceImages 배열을
   * [source, ...characters] 순서로 만들어야 한다.
   */
  characters: PanelImageEditReferenceCharacter[];
}

/**
 * SOURCE PANEL IMAGE(원본, reference 배열의 0번째)와 그 뒤에 오는
 * Character Sheet 참조 이미지들의 역할을 명시적으로 구분해서 알려준다.
 * 캐릭터 정체성 참조 이미지를 "새로 그릴 장면"으로 착각해 그 이미지
 * 속 배경/포즈가 결과에 섞여 들어가는 것을 방지하기 위함이다.
 */
function buildReferenceRoleMappingClause(characters: PanelImageEditReferenceCharacter[]): string {
  const lines = [
    "REFERENCE IMAGE ROLES:",
    "Reference image 1 = SOURCE PANEL IMAGE — this is the actual base image you are editing.",
  ];
  characters.forEach((c, i) => {
    lines.push(
      `Reference image ${i + 2} = CHARACTER REFERENCE ${String.fromCharCode(65 + i)} (${c.display_name}) — ` +
        "use this only to confirm that character's identity (face, hairstyle, body) must stay unchanged. " +
        "It is NOT a new scene to draw from and its background/pose must be ignored."
    );
  });
  return lines.join("\n");
}

export function buildPanelImageEditPrompt(input: BuildPanelImageEditPromptInput): string {
  const lines: string[] = [
    "EDIT TASK",
    "",
    "The SOURCE PANEL IMAGE (reference image 1) is the authoritative base image. Your job is to make the " +
      "smallest possible change to it, not to redraw or reinterpret the scene.",
    "",
  ];

  if (input.characters.length > 0) {
    lines.push(buildReferenceRoleMappingClause(input.characters), "");
  }

  lines.push(
    "Preserve everything in the SOURCE PANEL IMAGE that is not explicitly requested to change below. Keep unchanged:",
    "- character identity, face, hairstyle, and expression (unless the change request explicitly asks to change them)",
    "- pose, body proportions, and clothing",
    "- camera angle, composition, and crop",
    "- location, furniture, and background",
    "- lighting and time of day",
    "- colors and every object not mentioned in the change request",
    "",
    `CHANGE ONLY: ${input.editInstruction}`,
    "",
    "Do not redesign or reinterpret the scene beyond the change requested above. Do not add any new text, " +
      "logos, speech bubbles, symbols, or objects that are not part of the change request.",
    "Return a single clean edited version of the SOURCE PANEL IMAGE at the same aspect ratio and framing.",
    "",
    buildNegativeImageConstraintsClause()
  );

  return lines.join("\n");
}
