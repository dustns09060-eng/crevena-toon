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
export const COMMON_NEGATIVE_IMAGE_CONSTRAINTS: readonly string[] = [
  "no text",
  "no letters",
  "no words",
  "no captions",
  "no speech bubbles",
  "no signage with readable text",
  "no signature",
  "no fake artist signature",
  "no artist credit",
  "no watermark",
  "no logo",
];

export function buildNegativeImageConstraintsClause(extra: string[] = []): string {
  const all = [...COMMON_NEGATIVE_IMAGE_CONSTRAINTS, ...extra];
  return `Never render any of the following in the image: ${all.join(", ")}.`;
}
