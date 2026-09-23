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
  test("image_prompt에 한국어 대사를 그리라는 지시를 넣지 말라는 규칙이 있다", () => {
    expect(source).toMatch(/image_prompt에 한국어 대사나 텍스트를\s*\n?\s*그림에 그리라는 지시를 절대 넣지 마세요/);
  });

  test("image_prompt는 장면/포즈/행동/표정/카메라 구도만 담당한다는 규칙이 있다", () => {
    expect(source).toMatch(/장면, 포즈, 행동, 표정, 카메라 구도/);
  });

  test("dialogue와 narration은 자연스러운 한국어로 작성하라는 규칙이 있다", () => {
    expect(source).toMatch(/자연스러운 한국어로 작성하세요/);
  });

  test("panels 배열 길이와 panel_number 연속성에 대한 필수 규칙이 있다", () => {
    expect(source).toMatch(/panels 배열의 길이는 요청받은 컷 수와 정확히 같아야 합니다/);
    expect(source).toMatch(/panel_number는 1부터 시작해 빠짐없이 연속해야 합니다/);
  });

  test("실제 있었던 일처럼 소재를 지어내지 말라는 규칙이 있다(소재 추천)", () => {
    expect(source).toMatch(/사용자의 실제 과거 경험을 사실인 것처럼 지어내지 마세요/);
  });
});
