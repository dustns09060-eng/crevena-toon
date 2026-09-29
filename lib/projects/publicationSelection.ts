import type { ToonPanel } from "../../src/db/types";

export function selectPublicationPanels(panels: ToonPanel[], numbers: number[]): ToonPanel[] {
  if (numbers.length < 2 || numbers.length > 20 || new Set(numbers).size !== numbers.length ||
      numbers.some((n) => !Number.isInteger(n))) throw new Error("서로 다른 컷을 2~20장 선택해주세요.");
  const selected = [...numbers].sort((a, b) => a - b).map((n) => panels.find((p) => p.panel_number === n));
  if (selected.some((p) => !p?.raw_image_url || !p.image_url)) throw new Error("완성된 컷만 복사할 수 있습니다.");
  const result = selected as ToonPanel[];
  if (panels.some((p) => p.panel_type === "cover") && result[0].panel_type !== "cover") {
    throw new Error("표지를 포함해주세요.");
  }
  return result;
}
