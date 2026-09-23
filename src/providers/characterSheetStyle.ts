/**
 * Crevena Toon의 기본 그림 스타일. 특정 생존 작가의 화풍을 지칭하지
 * 않고, 일관된 캐릭터 재현에 유리한 특징 위주로 서술한다.
 *
 * 향후 다른 스타일을 추가할 수 있도록 상수/레지스트리로 분리했다.
 */

export interface ToonStyle {
  id: string;
  label: string;
  prompt: string;
}

export const TOON_STYLES: Record<string, ToonStyle> = {
  "warm-daily-webtoon": {
    id: "warm-daily-webtoon",
    label: "따뜻한 육아 일상 웹툰",
    prompt:
      "Art style: warm everyday-life webtoon illustration, clean modern digital art, soft rounded line work, " +
      "bright and cozy color palette, cute but not overly childish, simple and uncluttered backgrounds suitable " +
      "for Instagram, expressive and clearly readable facial expressions, a simplified character design that is " +
      "easy to reproduce identically across many panels. Do not imitate the signature style of any specific " +
      "named artist or existing copyrighted franchise.",
  },
};

export const DEFAULT_TOON_STYLE_ID = process.env.CREVENA_TOON_STYLE_ID ?? "warm-daily-webtoon";

export function getToonStyle(id: string = DEFAULT_TOON_STYLE_ID): ToonStyle {
  const style = TOON_STYLES[id];
  if (!style) throw new Error(`알 수 없는 Crevena Toon 스타일: ${id}`);
  return style;
}
