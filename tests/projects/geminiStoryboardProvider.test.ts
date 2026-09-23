import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

// system instruction 문자열은 export되어 있지 않으므로(프로바이더 내부 상수),
// 소스 파일 텍스트에서 핵심 규칙 문구가 실제로 존재하는지 확인한다 —
// STEP 5 §8/§9(한국어 대사와 image_prompt 분리) 요구사항이 프롬프트에
// 반영돼 있는지에 대한 회귀 가드다.
const source = fs.readFileSync(
  path.resolve(__dirname, "../../src/providers/geminiStoryboardProvider.ts"),
  "utf-8"
);

describe("geminiStoryboardProvider 프롬프트 규칙", () => {
  test("image_prompt에 한국어 대사/제목 글자를 그리라는 지시를 넣지 말라는 규칙이 있다", () => {
    expect(source).toMatch(/한국어 대사나 텍스트, 제목 글자를 그림에 그리라는 지시를 절대\s*\n?\s*넣지\s*\n?\s*마세요/);
  });

  test("image_prompt는 장면/포즈/행동/표정/카메라 구도만 담당한다는 규칙이 있다", () => {
    expect(source).toMatch(/장면, 포즈, 행동, 표정, 카메라 구도/);
  });

  test("dialogue와 narration은 자연스러운 한국어로 작성하라는 규칙이 있다", () => {
    expect(source).toMatch(/자연스러운 한국어로 작성하세요/);
  });

  test("panels 배열 길이와 panel_number 연속성에 대한 필수 규칙이 있다", () => {
    expect(source).toMatch(/panels 배열의 길이는 요청받은 "본문 장면 수"와 정확히 같아야 합니다/);
    expect(source).toMatch(/panel_number는 panels 배열 안에서 1부터 시작해 빠짐없이 연속해야 합니다/);
  });

  test("표지는 panels와 분리된 별도 필드라는 규칙이 있다", () => {
    expect(source).toMatch(/표지는 panels에 포함하지 않고 cover 필드에 따로 씁니다/);
  });

  test("표지 이미지 안에 실제 글자(제목)를 그리지 말라는 규칙이 있다", () => {
    expect(source).toMatch(/표지 이미지\s*\n?\s*안에 실제 글자를 그리라는 지시는 절대 넣지 마세요/);
  });

  test("한 장면당 최대 4명이라는 규칙이 있다", () => {
    expect(source).toMatch(/한 장면\(표지 포함\)에 등장하는 캐릭터는 최대 4명입니다/);
  });

  test("실제 있었던 일처럼 소재를 지어내지 말라는 규칙이 있다(소재 추천)", () => {
    expect(source).toMatch(/사용자의 실제 과거 경험을 사실인 것처럼 지어내지 마세요/);
  });

  test("characters/dialogue.character 필드에는 CHARACTER_A/B/C identifier만 쓰라는 규칙이 있다", () => {
    expect(source).toMatch(/CHARACTER_A, CHARACTER_B, CHARACTER_C/);
    expect(source).toMatch(/목록에 없는 새 인물을 만들어내지 마세요/);
  });

  test("본문 텍스트(dialogue.text 등)에는 이름/애칭을 써도 된다는 예외가 명시돼 있다", () => {
    expect(source).toMatch(/identifier 규칙은 characters\/dialogue\.character 필드에만 적용됩니다/);
  });

  test("프롬프트에 캐릭터 identifier 목록을 전달한다(buildIdentifiedCharacterContextText 사용)", () => {
    expect(source).toMatch(/buildIdentifiedCharacterContextText\(input\.characters\)/);
  });
});
