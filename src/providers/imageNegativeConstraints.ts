/**
 * STEP 4에서 Character Sheet 생성 중 가짜 서명 텍스트(fake artist
 * signature)가 발생한 것을 계기로, 향후 STEP 6의 image prompt
 * builder가 공통으로 재사용할 텍스트 오염 방지 규칙을 여기 정리한다.
 *
 * 이번 STEP(5)에서는 이미지를 생성하지 않지만, storyboard의
 * image_prompt를 만들 때 "이 프롬프트로 나중에 이미지를 생성할 때
 * 텍스트를 절대 그리면 안 된다"는 점을 스토리 생성 AI에게도 미리
 * 주지시키기 위해 사용한다.
 */
/**
 * 021→022 사이 실제 이미지 테스트에서 "DEADLINE"(노트북 화면 텍스트),
 * "Zzz"(잠자는 캐릭터 위 글자형 기호), Apple 로고(노트북에 실제 브랜드
 * 로고)가 그대로 렌더링되는 문제가 발견됐다. 기존 "no text"/"no logo"
 * 수준의 짧은 문구만으로는 막지 못했으므로, 이 목록을 구체적인 항목
 * 단위로 세분화해서 강화한다.
 */
export const COMMON_NEGATIVE_IMAGE_CONSTRAINTS: readonly string[] = [
  "no readable text",
  "no letters",
  "no lettering",
  "no words",
  "no readable numbers unless explicitly required by the scene",
  "no captions",
  "no speech bubbles",
  "no empty speech bubbles",
  "no text boxes",
  "no comic UI elements",
  "no sound-effect lettering",
  "no comic symbols containing letters (e.g. \"Zzz\")",
  "no signage with readable text",
  "no signature",
  "no fake artist signature",
  "no artist credit",
  "no watermark",
  "no logo",
  "no brand logos",
  "no trademarks",
  "no recognizable corporate symbols",
  "no Apple logo",
  "no device branding",
  "no arbitrary product branding",
];

export function buildNegativeImageConstraintsClause(extra: string[] = []): string {
  const all = [...COMMON_NEGATIVE_IMAGE_CONSTRAINTS, ...extra];
  return `Never render any of the following in the image: ${all.join(", ")}.`;
}
