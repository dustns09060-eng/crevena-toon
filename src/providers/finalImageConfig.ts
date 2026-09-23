/**
 * STEP 7 §21 — 최종 합성 이미지 출력 해상도. Instagram Feed 업로드 규격인
 * 4:5(1080x1350)를 기본값으로 한다. approved 원본 이미지가 어떤 비율로
 * 생성되든(예: 864x1184) 이 캔버스 크기 자체는 항상 고정이며, 실제 원본은
 * renderPanel.ts가 이 캔버스 안에 stretch 없이 contain 방식으로 배치한다.
 */
export const DEFAULT_FINAL_IMAGE_ASPECT_RATIO = process.env.FINAL_IMAGE_ASPECT_RATIO ?? "4:5";

export const DEFAULT_FINAL_IMAGE_SIZE = Number(process.env.FINAL_IMAGE_SIZE ?? 1080);

export function getFinalImageDimensions(aspectRatio: string = DEFAULT_FINAL_IMAGE_ASPECT_RATIO): {
  width: number;
  height: number;
} {
  const base = DEFAULT_FINAL_IMAGE_SIZE;
  if (aspectRatio === "4:5") return { width: base, height: Math.round((base * 5) / 4) };
  return { width: base, height: base };
}
