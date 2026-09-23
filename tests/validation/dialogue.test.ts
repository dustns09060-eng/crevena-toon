import { describe, expect, test } from "vitest";
import {
  validateDialogueCharacterIds,
  validateToonDialogue,
} from "../../src/db/validation.js";

const validItem = {
  id: "11111111-1111-4111-8111-111111111111",
  character_id: "22222222-2222-4222-8222-222222222222",
  text: "드디어 잤다!",
  bubble_type: "speech" as const,
  bubble: {
    x: 0.15,
    y: 0.1,
    width: 0.4,
    height: 0.2,
    tail_direction: "bottom-left" as const,
  },
};

describe("validateToonDialogue", () => {
  test("정상적인 normalized bubble 좌표는 통과한다", () => {
    const result = validateToonDialogue([validItem]);
    expect(result.valid).toBe(true);
  });

  test("bubble이 null이면(아직 배치 전) 통과한다", () => {
    const result = validateToonDialogue([{ ...validItem, bubble: null }]);
    expect(result.valid).toBe(true);
  });

  test.each([
    ["x가 음수", { ...validItem.bubble, x: -0.1 }],
    ["x가 1 초과", { ...validItem.bubble, x: 1.1 }],
    ["width가 0", { ...validItem.bubble, width: 0 }],
    ["width가 1 초과", { ...validItem.bubble, width: 1.5 }],
    ["height가 0", { ...validItem.bubble, height: 0 }],
    ["x + width가 1 초과", { ...validItem.bubble, x: 0.8, width: 0.4 }],
    ["y + height가 1 초과", { ...validItem.bubble, y: 0.8, height: 0.4 }],
  ])("범위를 벗어난 bubble 좌표는 거부된다: %s", (_label, bubble) => {
    const result = validateToonDialogue([{ ...validItem, bubble }]);
    expect(result.valid).toBe(false);
  });

  test("dialogue가 배열이 아니면 거부된다", () => {
    const result = validateToonDialogue({ not: "an array" });
    expect(result.valid).toBe(false);
  });

  test("character_id가 UUID가 아니면 거부된다", () => {
    const result = validateToonDialogue([{ ...validItem, character_id: "not-a-uuid" }]);
    expect(result.valid).toBe(false);
  });
});

describe("validateDialogueCharacterIds", () => {
  test("프로젝트에 연결된 캐릭터면 통과한다", () => {
    const result = validateDialogueCharacterIds(
      [{ character_id: "22222222-2222-4222-8222-222222222222" }],
      ["22222222-2222-4222-8222-222222222222"]
    );
    expect(result.valid).toBe(true);
  });

  test("프로젝트에 연결되지 않은 캐릭터면 거부된다", () => {
    const result = validateDialogueCharacterIds(
      [{ character_id: "99999999-9999-4999-8999-999999999999" }],
      ["22222222-2222-4222-8222-222222222222"]
    );
    expect(result.valid).toBe(false);
  });
});
