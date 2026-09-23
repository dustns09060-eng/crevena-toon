/**
 * STEP 7 §21 — 최종 합성 이미지 출력 해상도. 1:1 기준 1080x1080을
 * 기본값으로 하되, panelImageConfig.ts의 DEFAULT_PANEL_ASPECT_RATIO와
 * 같은 패턴으로 향후 4:5 등 다른 비율을 추가할 수 있도록 분리한다.
 */
export const DEFAULT_FINAL_IMAGE_ASPECT_RATIO = process.env.FINAL_IMAGE_ASPECT_RATIO ?? "1:1";

export const DEFAULT_FINAL_IMAGE_SIZE = Number(process.env.FINAL_IMAGE_SIZE ?? 1080);

export function getFinalImageDimensions(aspectRatio: string = DEFAULT_FINAL_IMAGE_ASPECT_RATIO): {
  width: number;
  height: number;
} {
  const base = DEFAULT_FINAL_IMAGE_SIZE;
  if (aspectRatio === "4:5") return { width: base, height: Math.round((base * 5) / 4) };
  return { width: base, height: base };
}
