import { describe, expect, test, vi } from "vitest";
import { renderPanelsInOrder } from "../../lib/editor/batchRender";

describe("full final render", () => {
  test("renders 20 in panel order and retains successful cuts after partial failure", async () => {
    const panels = Array.from({ length: 20 }, (_, i) => ({ id: String(i + 1), panelNumber: i + 1 })).reverse();
    const first = vi.fn(async (p: { id: string; panelNumber: number }) => {
      if (p.panelNumber === 7 || p.panelNumber === 12) throw Error("temporary");
    });
    const result = await renderPanelsInOrder(panels, new Set(), first);
    expect(first.mock.calls.map(([p]) => p.panelNumber)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(result.failed).toEqual([7, 12]);
    expect(result.completedIds.size).toBe(18);
    const retry = vi.fn(async () => {});
    const second = await renderPanelsInOrder(panels, result.completedIds, retry);
    expect(retry.mock.calls.map(([p]) => p.panelNumber)).toEqual([7, 12]);
    expect(second.failed).toEqual([]);
    expect(second.completedIds.size).toBe(20);
  });
});
