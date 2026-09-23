import { describe, expect, test } from "vitest";
import {
  assignCharacterIdentifiers,
  buildCharacterIdentifier,
  buildIdentifierToIdMap,
  MAX_IDENTIFIABLE_CHARACTERS,
} from "../../src/providers/characterIdentifier";

describe("buildCharacterIdentifier", () => {
  test("0번 인덱스는 CHARACTER_A", () => {
    expect(buildCharacterIdentifier(0)).toBe("CHARACTER_A");
  });
  test("1번 인덱스는 CHARACTER_B", () => {
    expect(buildCharacterIdentifier(1)).toBe("CHARACTER_B");
  });
  test("2번 인덱스는 CHARACTER_C", () => {
    expect(buildCharacterIdentifier(2)).toBe("CHARACTER_C");
  });
  test("범위를 벗어나면 에러를 던진다", () => {
    expect(() => buildCharacterIdentifier(MAX_IDENTIFIABLE_CHARACTERS)).toThrow();
    expect(() => buildCharacterIdentifier(-1)).toThrow();
  });
});

describe("assignCharacterIdentifiers", () => {
  test("배열 순서대로 CHARACTER_A, B, C...를 부여한다", () => {
    const result = assignCharacterIdentifiers([{ id: "1" }, { id: "2" }, { id: "3" }]);
    expect(result.map((r) => r.identifier)).toEqual(["CHARACTER_A", "CHARACTER_B", "CHARACTER_C"]);
  });

  test("표시 이름이 무엇이든(별칭/역할 변경) identifier는 순서에만 의존한다", () => {
    const result = assignCharacterIdentifiers([
      { id: "mom-id", display_name: "엄마" },
      { id: "kid-id", display_name: "별이" },
    ]);
    expect(result[0].identifier).toBe("CHARACTER_A");
    expect(result[0].character.display_name).toBe("엄마");
    expect(result[1].identifier).toBe("CHARACTER_B");
    expect(result[1].character.display_name).toBe("별이");
  });
});

describe("buildIdentifierToIdMap", () => {
  test("identifier -> character_id 매핑을 만든다", () => {
    const identified = assignCharacterIdentifiers([{ id: "mom-id" }, { id: "kid-id" }]);
    const map = buildIdentifierToIdMap(identified);
    expect(map.get("CHARACTER_A")).toBe("mom-id");
    expect(map.get("CHARACTER_B")).toBe("kid-id");
  });
});
