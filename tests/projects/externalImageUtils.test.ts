import { describe, expect, test } from "vitest";
import { EXTERNAL_IMAGE_MAX_BYTES, isExternalStoragePath, missingExternalPanelRows, reorderExternalImages, sortExternalImages, validateExternalImageFile, validateExternalImageFiles } from "../../lib/projects/externalImageUtils";
import { getFinalImageDimensions } from "../../src/providers/finalImageConfig";
import { computeContainRect } from "../../lib/editor/containFit";
import { buildZipEntries } from "../../lib/download/fileNaming";
import { validateProjectForm } from "../../lib/projects/formValidation";
import { PROJECT_DEFAULT_PANEL_COUNT } from "../../src/providers/projectPanelCountConfig";

const file = (name: string, size = 123, type = "image/png") => ({ name, size, type });
const eleven = [file("cover.png"), ...Array.from({ length: 10 }, (_, i) => file(`${String(i + 1).padStart(2, "0")}.png`))];

describe("external image selection", () => {
  test("11 files map cover then 01..10 even when selected out of order", () => {
    expect(sortExternalImages([...eleven].reverse()).map((f) => f.name)).toEqual(eleven.map((f) => f.name));
  });
  test("unknown filenames preserve chosen order; reorder and replace/remove change slots", () => {
    const selected = eleven.map((f, i) => ({ ...f, name: `photo-${i}.png` }));
    expect(sortExternalImages(selected)).toEqual(selected);
    const moved = reorderExternalImages(selected, 10, 0);
    expect(moved[0].name).toBe("photo-10.png");
    const replaced = [...moved]; replaced[1] = file("new.png");
    expect(replaced[1].name).toBe("new.png");
    replaced.splice(1, 1);
    expect(validateExternalImageFiles(replaced)).toContain("11장");
  });
  test("formats and sizes and exact count are checked before any upload", () => {
    expect(validateExternalImageFiles(eleven)).toBeNull();
    expect(validateExternalImageFiles(eleven.slice(0, 10))).toContain("11장");
    expect(validateExternalImageFiles([...eleven, file("12.png")])).toContain("11장");
    expect(validateExternalImageFile(file("x.exe"))).toContain("형식");
    expect(validateExternalImageFile(file("x.png", 100, "image/jpeg"))).toContain("형식");
    expect(validateExternalImageFile(file("x.jpeg", 100, "image/jpeg"))).toBeNull();
    expect(validateExternalImageFile(file("x.webp", 100, "image/webp"))).toBeNull();
    expect(validateExternalImageFile(file("x.png", EXTERNAL_IMAGE_MAX_BYTES + 1))).toContain("10MB");
  });
  test("batch paths are restricted to owned external prefix", () => {
    const name = "11111111-1111-4111-8111-111111111111_22222222-2222-4222-8222-222222222222.png";
    expect(isExternalStoragePath(`u/p/external/1/${name}`, "u", "p", 1)).toBe(true);
    expect(isExternalStoragePath(`u/p/raw/1/${name}`, "u", "p", 1)).toBe(false);
  });
  test("blank rows use cover at internal panel 1 without dialogue or AI prompt", () => {
    const rows = missingExternalPanelRows("project", [1, 2, 11]);
    expect(rows.map((row) => [row.panel_number, row.panel_type])).toEqual([[1, "cover"], [2, "scene"], [11, "scene"]]);
    expect(rows.every((row) => row.dialogue.length === 0 && row.image_prompt === null)).toBe(true);
  });
});

describe("new defaults do not reduce legacy panel support", () => {
  test("new project defaults to cover + ten scenes", () => expect(PROJECT_DEFAULT_PANEL_COUNT).toBe(11));
  test("2 and 20 remain valid; 21 invalid", () => {
    const base = { title: "에피소드", topic: "일상", character_ids: ["11111111-1111-4111-8111-111111111111"] };
    expect(validateProjectForm({ ...base, panel_count: 2 }).valid).toBe(true);
    expect(validateProjectForm({ ...base, panel_count: 20 }).valid).toBe(true);
    expect(validateProjectForm({ ...base, panel_count: 21 }).valid).toBe(false);
  });
  test("11 finals use existing 01..11 naming; 20 remains 01..20", () => {
    for (const count of [11, 20]) {
      const entries = buildZipEntries(Array.from({ length: count }, (_, i) => ({ panelNumber: count - i, bytes: new Uint8Array([count - i]) })));
      expect(entries).toHaveLength(count);
      expect(entries[0].filename).toBe("01.png");
      expect(entries.at(-1)?.filename).toBe(`${count}.png`);
      expect(entries[0].bytes[0]).toBe(1);
    }
  });
  test("4:5 final output contains a landscape source without stretching", () => {
    const { width, height } = getFinalImageDimensions("4:5");
    expect({ width, height }).toEqual({ width: 1080, height: 1350 });
    const rect = computeContainRect(width, height, 1600, 900);
    expect(rect.drawWidth / rect.drawHeight).toBeCloseTo(1600 / 900);
    expect(rect.drawWidth).toBeLessThanOrEqual(width);
    expect(rect.drawHeight).toBeLessThanOrEqual(height);
  });
});
