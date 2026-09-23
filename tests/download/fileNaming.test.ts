import { describe, expect, test } from "vitest";
import { buildPanelFileName, buildZipEntries, buildZipFileName } from "../../lib/download/fileNaming";

describe("buildPanelFileName", () => {
  test("0-indexed 입력을 01.png, 02.png ... 형식으로 만든다", () => {
    expect(buildPanelFileName(0)).toBe("01.png");
    expect(buildPanelFileName(8)).toBe("09.png");
    expect(buildPanelFileName(9)).toBe("10.png");
  });
});

describe("buildZipEntries", () => {
  test("panelNumber 순서대로 정렬해 01.png부터 순번을 매긴다", () => {
    const entries = buildZipEntries([
      { panelNumber: 3, bytes: new Uint8Array([3]) },
      { panelNumber: 1, bytes: new Uint8Array([1]) },
      { panelNumber: 2, bytes: new Uint8Array([2]) },
    ]);
    expect(entries.map((e) => e.filename)).toEqual(["01.png", "02.png", "03.png"]);
    // 정렬 후에도 원래 바이트가 올바른 순번에 매칭되어야 한다.
    expect(entries[0].bytes).toEqual(new Uint8Array([1]));
    expect(entries[2].bytes).toEqual(new Uint8Array([3]));
  });

  test("10컷도 01~10 순서를 유지한다", () => {
    const panels = Array.from({ length: 10 }, (_, i) => ({ panelNumber: i + 1, bytes: new Uint8Array([i]) }));
    const entries = buildZipEntries(panels);
    expect(entries.map((e) => e.filename)).toEqual([
      "01.png",
      "02.png",
      "03.png",
      "04.png",
      "05.png",
      "06.png",
      "07.png",
      "08.png",
      "09.png",
      "10.png",
    ]);
  });
});

describe("buildZipFileName", () => {
  test("제목을 안전한 zip 파일명으로 바꾼다", () => {
    expect(buildZipFileName("육아 일상툰")).toBe("육아-일상툰.zip");
  });

  test("파일시스템에 위험한 문자를 제거한다", () => {
    expect(buildZipFileName('제목:/\\*?"<>|')).toBe("제목.zip");
  });

  test("제목이 비어 있으면 기본 파일명을 쓴다", () => {
    expect(buildZipFileName("   ")).toBe("instatoon.zip");
  });
});
