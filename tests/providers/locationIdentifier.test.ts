import { describe, expect, test } from "vitest";
import {
  assignLocationIdentifiers,
  buildLocationIdentifier,
  buildLocationIdentifierToIdMap,
  MAX_IDENTIFIABLE_LOCATIONS,
} from "../../src/providers/locationIdentifier";

describe("buildLocationIdentifier", () => {
  test("0번 인덱스는 LOCATION_A", () => {
    expect(buildLocationIdentifier(0)).toBe("LOCATION_A");
  });
  test("1번 인덱스는 LOCATION_B", () => {
    expect(buildLocationIdentifier(1)).toBe("LOCATION_B");
  });
  test("2번 인덱스는 LOCATION_C", () => {
    expect(buildLocationIdentifier(2)).toBe("LOCATION_C");
  });
  test("범위를 벗어나면 에러를 던진다", () => {
    expect(() => buildLocationIdentifier(MAX_IDENTIFIABLE_LOCATIONS)).toThrow();
    expect(() => buildLocationIdentifier(-1)).toThrow();
  });
});

describe("assignLocationIdentifiers", () => {
  test("배열 순서대로 LOCATION_A, B, C...를 부여한다", () => {
    const result = assignLocationIdentifiers([{ id: "1" }, { id: "2" }, { id: "3" }]);
    expect(result.map((r) => r.identifier)).toEqual(["LOCATION_A", "LOCATION_B", "LOCATION_C"]);
  });

  test("표시 이름이 무엇이든 identifier는 순서에만 의존한다", () => {
    const result = assignLocationIdentifiers([
      { id: "living-id", display_name: "우리 집 거실" },
      { id: "bedroom-id", display_name: "우리 집 침실" },
    ]);
    expect(result[0].identifier).toBe("LOCATION_A");
    expect(result[0].location.display_name).toBe("우리 집 거실");
    expect(result[1].identifier).toBe("LOCATION_B");
    expect(result[1].location.display_name).toBe("우리 집 침실");
  });
});

describe("buildLocationIdentifierToIdMap", () => {
  test("identifier -> location_id 매핑을 만든다", () => {
    const identified = assignLocationIdentifiers([{ id: "living-id" }, { id: "bedroom-id" }]);
    const map = buildLocationIdentifierToIdMap(identified);
    expect(map.get("LOCATION_A")).toBe("living-id");
    expect(map.get("LOCATION_B")).toBe("bedroom-id");
  });
});
