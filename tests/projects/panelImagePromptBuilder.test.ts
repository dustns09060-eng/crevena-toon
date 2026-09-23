import { describe, expect, test } from "vitest";
import { buildPanelImagePrompt, COVER_COMPOSITION_NOTE } from "../../src/providers/panelImagePromptBuilder";

const momBible = {
  hairstyle: "짧은 단발머리",
  hair_color: "검은색", // 사용자가 최종 저장한 값
  face_features: "둥근 얼굴형",
  body_type: "보통 체형",
  representative_outfit: "검은 스트라이프 티셔츠",
  distinctive_features: null,
  visual_prompt: "30대 여성 캐릭터",
  negative_constraints: ["머리색을 바꾸지 않는다"],
};

const firstBible = {
  hairstyle: "짧은 단발머리",
  hair_color: "검은색",
  face_features: "둥글고 통통한 볼",
  body_type: "통통한 유아 체형",
  representative_outfit: "체리 패턴 잠옷",
  distinctive_features: null,
  visual_prompt: "5세 남아 캐릭터",
  negative_constraints: ["나이대를 바꾸지 않는다"],
};

describe("buildPanelImagePrompt", () => {
  test("Character Bible의 사용자 저장값을 그대로 반영한다 (source of truth)", () => {
    const prompt = buildPanelImagePrompt({
      sceneDescription: "거실",
      expression: "웃음",
      imagePrompt: "living room scene, medium shot",
      characters: [{ display_name: "엄마", characterBible: momBible }],
      style: "warm webtoon style",
      aspectRatio: "1:1",
    });
    expect(prompt).toContain("검은색");
    expect(prompt).toContain(momBible.hairstyle);
  });

  test("스토리보드가 실수로 다른 외형을 적어도(imagePrompt) Character Bible이 우선한다", () => {
    // storyboard AI가 실수로 image_prompt에 다른 머리색을 적은 상황을 흉내낸다.
    const prompt = buildPanelImagePrompt({
      sceneDescription: "거실",
      expression: "웃음",
      imagePrompt: "a brown haired mother sitting on the sofa",
      characters: [{ display_name: "엄마", characterBible: momBible }],
      style: "warm webtoon style",
      aspectRatio: "1:1",
    });
    // Character Bible 블록에 "Hair color: 검은색"이 명시적으로 존재해야 하고,
    // 이 값이 캐릭터 블록에서 최종 근거로 제시된다.
    expect(prompt).toMatch(/Hair color: 검은색/);
  });

  test("여러 캐릭터가 등장하면 CHARACTER A/B로 구분하고 섞지 말라는 지시를 포함한다", () => {
    const prompt = buildPanelImagePrompt({
      sceneDescription: "거실",
      expression: "놀람",
      imagePrompt: "wide shot",
      characters: [
        { display_name: "엄마", characterBible: momBible },
        { display_name: "첫째", characterBible: firstBible },
      ],
      style: "warm webtoon style",
      aspectRatio: "1:1",
    });
    expect(prompt).toContain("CHARACTER A");
    expect(prompt).toContain("CHARACTER B");
    expect(prompt).toMatch(/must not blend/);
  });

  test("단일 캐릭터면 '섞지 말라'는 지시가 없다", () => {
    const prompt = buildPanelImagePrompt({
      sceneDescription: "거실",
      expression: "웃음",
      imagePrompt: "medium shot",
      characters: [{ display_name: "엄마", characterBible: momBible }],
      style: "warm webtoon style",
      aspectRatio: "1:1",
    });
    expect(prompt).not.toMatch(/must not blend/);
  });

  test("공통 negative constraints(텍스트/워터마크 등)가 포함된다", () => {
    const prompt = buildPanelImagePrompt({
      sceneDescription: "거실",
      expression: "웃음",
      imagePrompt: "medium shot",
      characters: [{ display_name: "엄마", characterBible: momBible }],
      style: "warm webtoon style",
      aspectRatio: "1:1",
    });
    expect(prompt).toMatch(/no text/);
    expect(prompt).toMatch(/no speech bubbles/);
    expect(prompt).toMatch(/no fake artist signature/);
    expect(prompt).toMatch(/no watermark/);
  });

  test("말풍선을 위한 여백은 남기되 실제 말풍선을 그리지 말라는 지시가 있다", () => {
    const prompt = buildPanelImagePrompt({
      sceneDescription: "거실",
      expression: "웃음",
      imagePrompt: "medium shot",
      characters: [{ display_name: "엄마", characterBible: momBible }],
      style: "warm webtoon style",
      aspectRatio: "1:1",
    });
    expect(prompt).toMatch(/speech bubble may later be overlaid/);
    expect(prompt).toMatch(/do not draw any speech bubble/);
  });

  test("여러 캐릭터가 등장하면 reference 이미지 순서와 CHARACTER 라벨을 명시적으로 매핑한다", () => {
    const prompt = buildPanelImagePrompt({
      sceneDescription: "거실",
      expression: "놀람",
      imagePrompt: "wide shot",
      characters: [
        { display_name: "엄마", characterBible: momBible },
        { display_name: "첫째", characterBible: firstBible },
      ],
      style: "warm webtoon style",
      aspectRatio: "1:1",
    });
    expect(prompt).toMatch(/REFERENCE IMAGE MAPPING/);
    expect(prompt).toMatch(/Reference image 1 = CHARACTER A/);
    expect(prompt).toMatch(/Reference image 2 = CHARACTER B/);
  });

  test("단일 캐릭터면 reference mapping 지시가 없다", () => {
    const prompt = buildPanelImagePrompt({
      sceneDescription: "거실",
      expression: "웃음",
      imagePrompt: "medium shot",
      characters: [{ display_name: "엄마", characterBible: momBible }],
      style: "warm webtoon style",
      aspectRatio: "1:1",
    });
    expect(prompt).not.toMatch(/REFERENCE IMAGE MAPPING/);
  });

  test("coverNote를 전달하면 표지 전용 안내가 프롬프트에 포함된다", () => {
    const prompt = buildPanelImagePrompt({
      sceneDescription: "표지 장면",
      expression: "",
      imagePrompt: "cover composition",
      characters: [{ display_name: "엄마", characterBible: momBible }],
      style: "warm webtoon style",
      aspectRatio: "1:1",
      coverNote: COVER_COMPOSITION_NOTE,
    });
    expect(prompt).toMatch(/COVER image for the whole episode/);
    expect(prompt).toMatch(/do not draw any title text/);
  });

  test("coverNote가 없으면(본문 컷) 표지 전용 안내가 없다", () => {
    const prompt = buildPanelImagePrompt({
      sceneDescription: "거실",
      expression: "웃음",
      imagePrompt: "medium shot",
      characters: [{ display_name: "엄마", characterBible: momBible }],
      style: "warm webtoon style",
      aspectRatio: "1:1",
    });
    expect(prompt).not.toMatch(/COVER image for the whole episode/);
  });

  test("설정한 aspect ratio가 그대로 반영된다", () => {
    const prompt = buildPanelImagePrompt({
      sceneDescription: "거실",
      expression: "웃음",
      imagePrompt: "medium shot",
      characters: [{ display_name: "엄마", characterBible: momBible }],
      style: "warm webtoon style",
      aspectRatio: "4:5",
    });
    expect(prompt).toContain("4:5");
  });
});
