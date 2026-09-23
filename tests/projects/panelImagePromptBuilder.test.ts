import { describe, expect, test } from "vitest";
import {
  buildPanelImagePrompt,
  detectsNightTimeContext,
  COVER_COMPOSITION_NOTE,
  type PanelLocationContext,
} from "../../src/providers/panelImagePromptBuilder";

const livingRoom: PanelLocationContext = {
  display_name: "우리 집 거실",
  visual_prompt: "회색 소파가 있고 밝은 원목 바닥, 아이보리 러그와 낮은 책장이 있는 거실",
  wall_and_floor: "크림색 벽, 밝은 원목 바닥",
  fixed_furniture: "회색 패브릭 3인용 소파, 낮은 원목 책장",
  window_style: "큰 창문, 흰색 커튼",
  recurring_props: "화분 하나",
  distinctive_features: null,
};

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

  test("여백 지시에 'speech bubble' 개념을 긍정적으로 연상시키는 문구가 더 이상 없다", () => {
    // Production 실사용 결과 빈 말풍선이 자동 생성되는 문제가 발견됨 —
    // "말풍선이 나중에 들어갈 자리"라는 긍정 서술 자체가 원인으로
    // 지목되어, 순수 구도 지시("negative space")로만 표현하도록 수정했다.
    const prompt = buildPanelImagePrompt({
      sceneDescription: "거실",
      expression: "웃음",
      imagePrompt: "medium shot",
      characters: [{ display_name: "엄마", characterBible: momBible }],
      style: "warm webtoon style",
      aspectRatio: "1:1",
    });
    expect(prompt).not.toMatch(/speech bubble may later be overlaid/i);
    expect(prompt).not.toMatch(/where a speech bubble/i);
    expect(prompt).toMatch(/uncluttered negative space/);
    expect(prompt).toMatch(/without drawing any graphic UI element/);
  });

  test("강화된 negative constraints(빈 말풍선/텍스트 박스/comic UI 요소)가 포함된다", () => {
    const prompt = buildPanelImagePrompt({
      sceneDescription: "거실",
      expression: "웃음",
      imagePrompt: "medium shot",
      characters: [{ display_name: "엄마", characterBible: momBible }],
      style: "warm webtoon style",
      aspectRatio: "1:1",
    });
    expect(prompt).toMatch(/no empty speech bubbles/);
    expect(prompt).toMatch(/no text boxes/);
    expect(prompt).toMatch(/no comic UI elements/);
  });

  test("CHARACTER IDENTITY 우선순위 선언이 캐릭터가 있으면 포함된다", () => {
    const prompt = buildPanelImagePrompt({
      sceneDescription: "거실",
      expression: "웃음",
      imagePrompt: "medium shot",
      characters: [{ display_name: "엄마", characterBible: momBible }],
      style: "warm webtoon style",
      aspectRatio: "1:1",
    });
    expect(prompt).toMatch(/CHARACTER IDENTITY \/ REFERENCE — HIGHEST PRIORITY/);
    expect(prompt).toMatch(/authoritative source of that character's visual identity/);
    expect(prompt).toMatch(/must adapt around each character's fixed identity/);
    expect(prompt).toMatch(/never redesign or reinterpret a character's face, age, or body/);
  });

  test("SCENE이 COMPOSITION보다 우선한다는 명시적 지시가 포함된다", () => {
    const prompt = buildPanelImagePrompt({
      sceneDescription: "거실에서 저녁을 먹는 장면",
      expression: "웃음",
      imagePrompt: "kitchen wide shot",
      characters: [{ display_name: "엄마", characterBible: momBible }],
      style: "warm webtoon style",
      aspectRatio: "1:1",
    });
    expect(prompt).toMatch(/SCENE \(AUTHORITATIVE/);
    expect(prompt).toMatch(/COMPOSITION \(secondary/);
    expect(prompt).toMatch(/SCENE FACTS ARE AUTHORITATIVE/);
    expect(prompt).toMatch(/follow SCENE and adjust the composition to match it/);
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

  test("명확한 NIGHT 장면(예: '육퇴', '잠든')이면 밤 지시(창밖=밤, 실내=따뜻한 조명)가 포함된다", () => {
    const prompt = buildPanelImagePrompt({
      sceneDescription: "아이들이 잠든 뒤 엄마가 소파에 앉아 육퇴를 만끽하는 장면",
      expression: "행복함",
      imagePrompt: "mom relaxing on the sofa",
      characters: [{ display_name: "엄마", characterBible: momBible }],
      style: "warm webtoon style",
      aspectRatio: "1:1",
    });
    expect(prompt).toMatch(/TIME OF DAY: This scene takes place at night/);
    expect(prompt).toMatch(/no sunlight/);
    expect(prompt).toMatch(/no daylight/);
    expect(prompt).toMatch(/warm artificial indoor lighting/);
    // 밤이라고 전체를 어둡게 만들라는 지시는 아니어야 한다.
    expect(prompt).toMatch(/should still look bright, warm, and clearly readable/);
  });

  test("일반적인 낮/저녁 식사 장면에는 밤 지시가 잘못 들어가지 않는다", () => {
    const prompt = buildPanelImagePrompt({
      sceneDescription: "저녁 식사 시간, 난장판이 된 식탁에서 두 아이 밥 먹이느라 바쁜 엄마.",
      expression: "정신없음",
      imagePrompt: "a messy dining room scene",
      characters: [{ display_name: "엄마", characterBible: momBible }],
      style: "warm webtoon style",
      aspectRatio: "1:1",
    });
    expect(prompt).not.toMatch(/TIME OF DAY: This scene takes place at night/);
  });

  test("detectsNightTimeContext — 밤 관련 키워드가 있으면 true", () => {
    expect(detectsNightTimeContext("육퇴 이후 조용한 거실", "")).toBe(true);
    expect(detectsNightTimeContext("아이들이 잠든 뒤", "")).toBe(true);
    expect(detectsNightTimeContext("", "a dark night scene")).toBe(true);
    expect(detectsNightTimeContext("늦은 밤 노트북 앞에서", "")).toBe(true);
  });

  test("detectsNightTimeContext — 밤 관련 키워드가 없으면 false", () => {
    expect(detectsNightTimeContext("저녁 식사 시간, 식탁에서 밥을 먹는다", "a messy dining room")).toBe(false);
    expect(detectsNightTimeContext("거실에서 장난감을 정리한다", "living room, toys")).toBe(false);
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

describe("buildPanelImagePrompt — Location Bible(021)", () => {
  test("location이 있으면 LOCATION/TIME CONTINUITY 블록에 고정 요소(가구/창문 등)가 포함된다", () => {
    const prompt = buildPanelImagePrompt({
      sceneDescription: "거실에서 대화하는 장면",
      expression: "웃음",
      imagePrompt: "medium shot",
      characters: [{ display_name: "엄마", characterBible: momBible }],
      style: "warm webtoon style",
      aspectRatio: "1:1",
      location: livingRoom,
    });
    expect(prompt).toMatch(/LOCATION \/ TIME CONTINUITY/);
    expect(prompt).toMatch(/우리 집 거실/);
    expect(prompt).toMatch(/회색 패브릭 3인용 소파/);
    expect(prompt).toMatch(/architecture and fixed furniture.*must stay exactly as described/s);
  });

  test("location이 없으면(레거시) LOCATION 블록이 없다", () => {
    const prompt = buildPanelImagePrompt({
      sceneDescription: "거실",
      expression: "웃음",
      imagePrompt: "medium shot",
      characters: [{ display_name: "엄마", characterBible: momBible }],
      style: "warm webtoon style",
      aspectRatio: "1:1",
    });
    expect(prompt).not.toMatch(/LOCATION \/ TIME CONTINUITY/);
  });

  test("고급 설정(wall_and_floor 등)이 없어도(null) 필수 필드만으로 정상 동작한다", () => {
    const prompt = buildPanelImagePrompt({
      sceneDescription: "거실",
      expression: "웃음",
      imagePrompt: "medium shot",
      characters: [{ display_name: "엄마", characterBible: momBible }],
      style: "warm webtoon style",
      aspectRatio: "1:1",
      location: {
        display_name: "우리 집 거실",
        visual_prompt: "따뜻한 분위기의 거실",
        wall_and_floor: null,
        fixed_furniture: null,
        window_style: null,
        recurring_props: null,
        distinctive_features: null,
      },
    });
    expect(prompt).toMatch(/우리 집 거실/);
    expect(prompt).not.toMatch(/Walls\/floor:/);
  });

  test("구조화된 time_of_day='NIGHT'이면 키워드 감지 없이도 밤 지시가 포함된다", () => {
    const prompt = buildPanelImagePrompt({
      sceneDescription: "거실에서 커피를 마시는 장면", // 키워드 없음
      expression: "행복함",
      imagePrompt: "medium shot",
      characters: [{ display_name: "엄마", characterBible: momBible }],
      style: "warm webtoon style",
      aspectRatio: "1:1",
      timeOfDay: "NIGHT",
    });
    expect(prompt).toMatch(/TIME OF DAY: This scene takes place at night/);
  });

  test("구조화된 time_of_day='DAY'이면 키워드가 있어도(우연히) 밤 지시가 없다 — 구조화 필드가 항상 우선", () => {
    const prompt = buildPanelImagePrompt({
      sceneDescription: "밤늦게까지 놀이터에서 노는 낮 장면", // "밤"이라는 글자가 우연히 포함
      expression: "웃음",
      imagePrompt: "medium shot",
      characters: [{ display_name: "엄마", characterBible: momBible }],
      style: "warm webtoon style",
      aspectRatio: "1:1",
      timeOfDay: "DAY",
    });
    expect(prompt).not.toMatch(/TIME OF DAY: This scene takes place at night/);
  });

  test("time_of_day='LATE_NIGHT'도 NIGHT와 동일하게 밤 지시를 포함한다", () => {
    const prompt = buildPanelImagePrompt({
      sceneDescription: "거실에서 작업하는 장면",
      expression: "지침",
      imagePrompt: "medium shot",
      characters: [{ display_name: "엄마", characterBible: momBible }],
      style: "warm webtoon style",
      aspectRatio: "1:1",
      timeOfDay: "LATE_NIGHT",
    });
    expect(prompt).toMatch(/TIME OF DAY: This scene takes place at night/);
  });
});
