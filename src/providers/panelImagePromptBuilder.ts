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

/**
 * 021 — Location Bible 컨텍스트. display_name/visual_prompt만 필수이고
 * 나머지("고급 설정")는 값이 있을 때만 프롬프트에 반영한다.
 */
export interface PanelLocationContext {
  display_name: string;
  visual_prompt: string;
  wall_and_floor: string | null;
  fixed_furniture: string | null;
  window_style: string | null;
  recurring_props: string | null;
  distinctive_features: string | null;
}

export type PanelTimeOfDay = "MORNING" | "DAY" | "EVENING" | "NIGHT" | "LATE_NIGHT";

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
  /** 021 — 이 컷이 사용하는 Location Bible. 없으면(null/undefined) 장소 지시를 넣지 않는다(레거시와 동일). */
  location?: PanelLocationContext | null;
  /**
   * 021 — 구조화된 시간대. 있으면 detectsNightTimeContext 키워드 감지보다
   * 항상 우선한다. 없으면(null/undefined) 기존 키워드 감지로 폴백한다
   * (레거시 panel 호환).
   */
  timeOfDay?: PanelTimeOfDay | null;
}

function buildCharacterBlock(index: number, ctx: PanelCharacterContext): string {
  const b = ctx.characterBible;
  const lines = [
    `CHARACTER ${String.fromCharCode(65 + index)} — ${ctx.display_name}`,
    `Hairstyle: ${b.hairstyle}`,
    `Hair color: ${b.hair_color}`,
    `Face features: ${b.face_features}`,
    `Body type / age-appropriate proportions: ${b.body_type}`,
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
 * 캐릭터 정체성을 장면 연출보다 우선시키라는 명시적 위계 선언.
 * approved Character Sheet가 이 컷의 권위 있는(authoritative) 외형
 * 기준이며, 장면 연출은 그 정체성을 바꾸지 않는 선에서만 구성되어야
 * 한다는 것을 모델에게 직접 말해준다 — 실제 생성 결과에서 컷마다
 * 얼굴형/눈/체형이 흔들리는 문제(엄마가 컷에 따라 다른 사람처럼
 * 보이는 문제)에 대응하기 위함이다.
 */
const CHARACTER_IDENTITY_PRIORITY_CLAUSE = [
  "CHARACTER IDENTITY / REFERENCE — HIGHEST PRIORITY:",
  "The approved Character Sheet reference image for each character is the single authoritative source of that " +
    "character's visual identity for this panel.",
  "Preserve, for every character, exactly the same face shape, eyes, hairstyle, hair color, age appearance, " +
    "body proportions, and distinctive features shown in their reference image.",
  "The scene composition must adapt around each character's fixed identity — never redesign or reinterpret a " +
    "character's face, age, or body to better fit the scene, camera angle, or mood.",
  "Different pose, expression, hand gesture, outfit, props, background, and camera angle are allowed and " +
    "expected to vary per scene — but the character's core identity above must remain unchanged.",
].join("\n");

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

/**
 * scene/image_prompt 자유 텍스트에 이미 명확한 "밤" 계열 표현이 있는
 * 경우에만 시간대 지시를 추가한다(DB에 time_of_day 컬럼이 없는 현재
 * 구조에서, 이미 존재하는 텍스트만으로 판단하는 최소 개선). 애매한
 * 경우(예: 단순 "저녁 식사")는 트리거하지 않아 낮 장면에 밤 지시가
 * 잘못 섞여 들어가지 않게 한다. 특정 프로젝트/컷 번호에 대한 하드코딩이
 * 아니라 텍스트 키워드 기반의 재사용 가능한 규칙이다.
 */
const NIGHT_TIME_KEYWORDS = [
  "늦은 밤",
  "밤중",
  "밤",
  "잠든",
  "잠들",
  "재우고",
  "재운",
  "육퇴",
  "late night",
  "night",
  "evening",
];

export function detectsNightTimeContext(sceneDescription: string, imagePrompt: string): boolean {
  const haystack = `${sceneDescription} ${imagePrompt}`.toLowerCase();
  return NIGHT_TIME_KEYWORDS.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

/**
 * 021 — 구조화된 time_of_day가 있으면 그 값을 그대로 신뢰하고(NIGHT/
 * LATE_NIGHT일 때만 true), 없으면(레거시 panel) 기존 키워드 감지로
 * 폴백한다. 구조화 필드가 항상 키워드 감지보다 우선한다.
 */
function isNightTimeOfDay(
  timeOfDay: PanelTimeOfDay | null | undefined,
  sceneDescription: string,
  imagePrompt: string
): boolean {
  if (timeOfDay) return timeOfDay === "NIGHT" || timeOfDay === "LATE_NIGHT";
  return detectsNightTimeContext(sceneDescription, imagePrompt);
}

/**
 * 021 — Location Bible을 프롬프트 블록으로 변환한다. 카메라 각도나
 * 캐릭터 위치가 달라져도 이 장소의 건축 구조/고정 가구는 그대로
 * 유지되어야 한다는 것을 명시해, 같은 거실이 컷마다 다른 집처럼
 * 생성되는 문제(조사 결과 확인된 근본 원인)에 대응한다.
 */
function buildLocationBlock(location: PanelLocationContext): string {
  const lines = [
    "LOCATION / TIME CONTINUITY:",
    `Location: ${location.display_name} — ${location.visual_prompt}`,
  ];
  if (location.wall_and_floor) lines.push(`Walls/floor: ${location.wall_and_floor}`);
  if (location.fixed_furniture) lines.push(`Fixed furniture: ${location.fixed_furniture}`);
  if (location.window_style) lines.push(`Window: ${location.window_style}`);
  if (location.recurring_props) lines.push(`Recurring props: ${location.recurring_props}`);
  if (location.distinctive_features) lines.push(`Distinctive features: ${location.distinctive_features}`);
  lines.push(
    "This location's architecture and fixed furniture (walls, floor, windows, and the furniture listed above) " +
      "must stay exactly as described regardless of camera angle or character positions — only lighting, " +
      "exterior brightness, and sky may change with time of day."
  );
  return lines.join("\n");
}

/**
 * NIGHT 시간대 지시. "밤이니까 전체를 어둡게"가 아니라
 * "창밖=밤, 실내=따뜻한 인공조명"을 명시해 웹툰 특유의 밝고 읽기
 * 좋은 분위기는 유지하면서 낮/밤 불일치(육퇴 이후인데 창밖이 대낮인
 * 문제)만 바로잡는다.
 */
function buildNightTimeClause(): string {
  return [
    "TIME OF DAY: This scene takes place at night.",
    "OUTSIDE (through any window or open doorway): dark night sky, deep navy/dark-blue tones, no sunlight, " +
      "no daylight, no bright daytime exterior, no visible sun, no daytime shadows on the floor.",
    "INSIDE: warm artificial indoor lighting (ceiling light, lamp, or soft ambient glow) — the room itself " +
      "should still look bright, warm, and clearly readable; do not make the overall image dark or dim.",
  ].join("\n");
}

/**
 * 실제 이미지 테스트에서 노트북 화면에 "DEADLINE" 글자, Apple 로고가
 * 그려지는 문제가 발견되어 추가한 절. imageNegativeConstraints의 짧은
 * 금지 목록만으로는 "그럼 화면/전자기기를 어떻게 그려야 하는지"에 대한
 * 긍정적 지시가 없어 모델이 스스로 그럴듯한 텍스트/로고로 채워 넣는
 * 경향이 있었다 — 이 절은 "빈 화면/추상 UI + 브랜드 없는 전자기기"라는
 * 대안을 명시적으로 제시한다. 단, 시계처럼 시간이 장면에 중요한 경우는
 * 바늘 표현을 예외로 허용한다(글자/숫자가 아니라 바늘 위치이므로
 * "no readable text/numbers" 제약과 충돌하지 않는다).
 */
function buildElectronicsAndClockClause(): string {
  return [
    "ELECTRONICS & CLOCKS:",
    "Any laptop, phone, tablet, TV, or other screen must be generic and unbranded — no manufacturer logos, " +
      "no on-screen readable text, icons, or UI text unless the scene explicitly requires specific screen " +
      "content to make sense. When in doubt, render the screen as blank, off, or an abstract glow/soft light " +
      "instead of inventing text or a logo.",
    "Exception: if the scene depends on a character checking the time, an analog wall clock or watch with " +
      "clock hands showing approximately the correct time is allowed and encouraged — clock hands are not " +
      "considered readable text.",
  ].join("\n");
}

/**
 * SCENE completed-state 규칙 — 실제 테스트에서 "소파로 뛰어들어 털썩
 * 누웠다"처럼 여러 동작이 이어지는 장면 묘사가, 최종 상태(누움)가 아닌
 * 중간 동작(공중에서 점프)으로 그려지는 문제가 발견됐다. SCENE이
 * 여러 동작을 서술할 때는 마지막 완결 상태를 그리라고 명시한다.
 */
const SCENE_COMPLETED_STATE_CLAUSE =
  "If SCENE describes a sequence of actions ending in a completed state (e.g. \"jumps onto the sofa and " +
  "flops down\" → lying down; \"sits down and opens the laptop\" → seated with laptop open), depict that " +
  "final completed state, not an intermediate moment (e.g. mid-air, mid-motion) — unless SCENE or COMPOSITION " +
  "explicitly asks for the intermediate moment itself.";

export function buildPanelImagePrompt(input: BuildPanelImagePromptInput): string {
  const lines: string[] = [
    `Generate a single Instagram daily-life comic panel illustration, aspect ratio ${input.aspectRatio}.`,
    input.style,
  ];

  if (input.coverNote) {
    lines.push("", input.coverNote);
  }

  // 1. CHARACTER IDENTITY / REFERENCE — 최우선순위.
  if (input.characters.length > 0) {
    lines.push("", CHARACTER_IDENTITY_PRIORITY_CLAUSE);
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

  // 3. LOCATION / TIME CONTINUITY.
  if (input.location) {
    lines.push("", buildLocationBlock(input.location));
  }
  if (isNightTimeOfDay(input.timeOfDay, input.sceneDescription, input.imagePrompt)) {
    lines.push("", buildNightTimeClause());
  }

  // 4. SCENE ACTION — 실제로 무슨 일이 일어나는지의 authoritative source.
  // 5. COMPOSITION / CAMERA — 구도/카메라를 보조하는 secondary source.
  //    COMPOSITION이 SCENE의 장소/행동/소품/시간대와 충돌하면 SCENE이
  //    우선한다는 것을 명시해, Storyboard AI가 만든 두 자유 텍스트
  //    필드(scene 한글 / image_prompt 영문)가 서로 다른 내용을 말할 때
  //    이미지가 둘을 억지로 절충(예: 허공에 뜬 노트북)하지 않게 한다.
  lines.push(
    "",
    `SCENE (AUTHORITATIVE — what actually happens): ${input.sceneDescription}`,
    `COMPOSITION (secondary — camera/framing/pose only): ${input.imagePrompt}`,
    "SCENE FACTS ARE AUTHORITATIVE. Composition instructions must never contradict the scene's location, " +
      "character actions, major objects, or time of day — if COMPOSITION conflicts with SCENE on any of these, " +
      "follow SCENE and adjust the composition to match it, not the other way around.",
    SCENE_COMPLETED_STATE_CLAUSE,
    // 6. EXPRESSION / SECONDARY DETAILS.
    `EXPRESSION/ACTION (secondary detail): ${input.expression}`,
    "",
    "Keep some naturally uncluttered negative space near the upper portion of the composition, without drawing " +
      "any graphic UI element there.",
    "",
    buildElectronicsAndClockClause(),
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
