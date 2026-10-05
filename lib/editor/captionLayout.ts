import { wrapText } from "./bubbleLayout";

/** A separate caption area keeps every pixel of the artwork visible. */
export function computeCaptionLayout(texts: string[], width: number, height: number, measure: (text: string) => number) {
  const fontSize = width * 36 / 1080;
  const lineHeight = fontSize * 1.55;
  const padding = width * 0.04;
  const blocks = texts.filter((text) => text.trim()).map((text) => text.split(/\r?\n/).flatMap((line) => wrapText(measure, line, width - padding * 2)));
  const captionHeight = blocks.length ? padding * 2 + blocks.reduce((total, lines) => total + lines.length * lineHeight, 0) + (blocks.length - 1) * fontSize * 0.6 : 0;
  if (captionHeight > height * 0.42) throw new Error("대사가 너무 길어 그림 영역을 확보할 수 없습니다. 문장을 줄이거나 컷을 나눠주세요.");
  return { blocks, captionHeight, artHeight: height - captionHeight, padding, fontSize, lineHeight };
}
