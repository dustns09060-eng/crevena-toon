import { describe, expect, it } from "vitest";
import { selectPublicationPanels } from "../lib/projects/publicationSelection";
import type { ToonPanel } from "../src/db/types";

const panels = [1, 2, 3, 4].map((n) => ({ panel_number: n, panel_type: n === 1 ? "cover" : "scene", raw_image_url: `raw/${n}`, image_url: `final/${n}` } as ToonPanel));
describe("publication selection", () => {
  it("preserves story order and leaves original panels intact", () => {
    expect(selectPublicationPanels(panels, [4, 1, 2]).map((p) => p.panel_number)).toEqual([1, 2, 4]);
    expect(panels.map((p) => p.panel_number)).toEqual([1, 2, 3, 4]);
  });
  it("rejects missing, duplicate, fractional and incomplete selections", () => {
    for (const numbers of [[1], [1, 1], [1, 5], [1, 2.5], [2, 3]]) {
      expect(() => selectPublicationPanels(panels, numbers)).toThrow();
    }
    expect(() => selectPublicationPanels([{ ...panels[0], image_url: null }, panels[1]], [1, 2])).toThrow();
  });
});
