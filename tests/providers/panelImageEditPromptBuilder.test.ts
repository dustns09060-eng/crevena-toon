import { describe, expect, test } from "vitest";
import { buildPanelImageEditPrompt } from "../../src/providers/panelImageEditPromptBuilder";

describe("buildPanelImageEditPrompt — 기존 candidate 이미지 부분 수정 전용 prompt", () => {
  test("SOURCE PANEL IMAGE가 CHARACTER REFERENCE보다 먼저 언급된다(deterministic reference ordering)", () => {
    const prompt = buildPanelImageEditPrompt({
      editInstruction: "노트북 뚜껑의 로고만 제거해주세요",
      characters: [{ display_name: "엄마" }, { display_name: "별이" }],
    });
    const sourceIdx = prompt.indexOf("SOURCE PANEL IMAGE");
    const charAIdx = prompt.indexOf("CHARACTER REFERENCE A");
    const charBIdx = prompt.indexOf("CHARACTER REFERENCE B");
    expect(sourceIdx).toBeGreaterThanOrEqual(0);
    expect(charAIdx).toBeGreaterThan(sourceIdx);
    expect(charBIdx).toBeGreaterThan(charAIdx);
  });

  test("각 캐릭터 참조는 이름과 함께 '정체성 확인용'이며 새 장면이 아니라고 명시한다", () => {
    const prompt = buildPanelImageEditPrompt({
      editInstruction: "로고 제거",
      characters: [{ display_name: "엄마" }],
    });
    expect(prompt).toMatch(/CHARACTER REFERENCE A \(엄마\)/);
    expect(prompt).toMatch(/NOT a new scene to draw from/);
  });

  test("editInstruction이 CHANGE ONLY 절에 그대로 포함된다", () => {
    const prompt = buildPanelImageEditPrompt({
      editInstruction: "노트북 뚜껑의 로고만 제거해주세요",
      characters: [{ display_name: "엄마" }],
    });
    expect(prompt).toMatch(/CHANGE ONLY: 노트북 뚜껑의 로고만 제거해주세요/);
  });

  test("캐릭터 identity/pose/location/lighting 등 유지 목록이 명시된다", () => {
    const prompt = buildPanelImageEditPrompt({
      editInstruction: "로고 제거",
      characters: [{ display_name: "엄마" }],
    });
    expect(prompt).toMatch(/character identity, face, hairstyle/);
    expect(prompt).toMatch(/pose, body proportions, and clothing/);
    expect(prompt).toMatch(/camera angle, composition, and crop/);
    expect(prompt).toMatch(/location, furniture, and background/);
    expect(prompt).toMatch(/lighting and time of day/);
  });

  test("장면을 재해석하거나 새 텍스트/로고/말풍선을 추가하지 말라는 지시가 포함된다", () => {
    const prompt = buildPanelImageEditPrompt({
      editInstruction: "로고 제거",
      characters: [{ display_name: "엄마" }],
    });
    expect(prompt).toMatch(/Do not redesign or reinterpret the scene/);
    expect(prompt).toMatch(/Do not add any new text, .*logos, speech bubbles, symbols/s);
  });

  test("기존 negative constraints(텍스트/로고/워터마크 등)가 재사용된다", () => {
    const prompt = buildPanelImageEditPrompt({
      editInstruction: "로고 제거",
      characters: [{ display_name: "엄마" }],
    });
    expect(prompt).toMatch(/no readable text/);
    expect(prompt).toMatch(/no Apple logo/);
    expect(prompt).toMatch(/no speech bubbles/);
  });

  test("캐릭터가 없으면 REFERENCE IMAGE ROLES 절 자체가 없다", () => {
    const prompt = buildPanelImageEditPrompt({ editInstruction: "로고 제거", characters: [] });
    expect(prompt).not.toMatch(/REFERENCE IMAGE ROLES/);
    expect(prompt).not.toMatch(/CHARACTER REFERENCE/);
  });

  test("EDIT TASK 헤더로 시작해 일반 생성 prompt와 구조적으로 구분된다", () => {
    const prompt = buildPanelImageEditPrompt({ editInstruction: "로고 제거", characters: [{ display_name: "엄마" }] });
    expect(prompt.startsWith("EDIT TASK")).toBe(true);
  });
});
