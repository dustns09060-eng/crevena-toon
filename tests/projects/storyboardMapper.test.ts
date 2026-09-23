import { describe, expect, test } from "vitest";
import { mapStoryboardRawToDraft } from "../../src/providers/storyboardMapper";
import { buildIdentifierToIdMap } from "../../src/providers/characterIdentifier";
import type { StoryboardRaw } from "../../src/providers/storyboardSchema";

const MOM_ID = "11111111-1111-4111-8111-111111111111";
const FIRST_ID = "22222222-2222-4222-8222-222222222222";

const identifierToId = buildIdentifierToIdMap([
  { identifier: "CHARACTER_A", character: { id: MOM_ID } },
  { identifier: "CHARACTER_B", character: { id: FIRST_ID } },
]);

const raw: StoryboardRaw = {
  title: "제목",
  summary: "요약",
  cover: {
    cover_title: "우리 가족 이야기",
    cover_subtitle: "오늘의 에피소드",
    scene_description: "표지 대표 장면",
    characters: ["CHARACTER_A"],
    image_prompt: "mother smiling, cover composition",
  },
  panels: [
    {
      panel_number: 1,
      scene_description: "거실",
      characters: ["CHARACTER_A", "CHARACTER_B"],
      expressions: ["웃음"],
      actions: ["안아준다"],
      dialogue: [{ character: "CHARACTER_A", text: "안녕" }],
      narration: "평온한 아침",
      image_prompt: "mother and son in living room",
    },
  ],
};

describe("mapStoryboardRawToDraft — CHARACTER_A/B/C identifier 매핑", () => {
  test("표지가 항상 panels[0], panel_number=1, panel_type='cover'로 들어간다", () => {
    const draft = mapStoryboardRawToDraft(raw, identifierToId);

    expect(draft.panels[0].panel_type).toBe("cover");
    expect(draft.panels[0].panel_number).toBe(1);
    expect(draft.panels[0].cover_title).toBe("우리 가족 이야기");
    expect(draft.panels[0].cover_subtitle).toBe("오늘의 에피소드");
    expect(draft.panels[0].character_ids).toEqual([MOM_ID]);
  });

  test("본문 장면은 panel_number 2부터 시작하고 panel_type='scene'이다", () => {
    const draft = mapStoryboardRawToDraft(raw, identifierToId);

    expect(draft.panels[1].panel_type).toBe("scene");
    expect(draft.panels[1].panel_number).toBe(2);
    expect(draft.panels[1].cover_title).toBeNull();
    expect(draft.panels[1].character_ids).toEqual([MOM_ID, FIRST_ID]);
    expect(draft.panels[1].dialogue[0].character_id).toBe(MOM_ID);
  });

  test("한국어 대사(dialogue.text)와 image_prompt가 서로 분리된 필드로 유지된다", () => {
    const draft = mapStoryboardRawToDraft(raw, identifierToId);

    expect(draft.panels[1].dialogue[0].text).toBe("안녕");
    expect(draft.panels[1].image_prompt).toBe("mother and son in living room");
    expect(draft.panels[1].image_prompt).not.toContain("안녕");
  });

  test("expressions와 actions를 하나의 expression 문자열로 합친다", () => {
    const draft = mapStoryboardRawToDraft(raw, identifierToId);
    expect(draft.panels[1].expression).toBe("웃음, 안아준다");
  });

  test("narration/cover_subtitle이 undefined(Gemini가 optional 필드를 생략한 경우)면 null로 정규화된다", () => {
    // Production 20장 버그 재현: 이 값들은 optional이라 raw에 키 자체가
    // 없을 수 있다. Draft 타입은 `string | null`이므로 undefined가 그대로
    // DB에 넘어가면 안 되고 null로 정규화되어야 한다.
    const rawWithoutOptionalFields = {
      ...raw,
      cover: { ...raw.cover, cover_subtitle: undefined },
      panels: [{ ...raw.panels[0], narration: undefined }],
    } as unknown as StoryboardRaw;

    const draft = mapStoryboardRawToDraft(rawWithoutOptionalFields, identifierToId);
    expect(draft.panels[0].cover_subtitle).toBeNull();
    expect(draft.panels[1].narration).toBeNull();
  });

  test("본문에 등록되지 않은 identifier(CHARACTER_Z)가 있으면 에러를 던진다", () => {
    const badRaw: StoryboardRaw = {
      ...raw,
      panels: [{ ...raw.panels[0], characters: ["CHARACTER_Z"] }],
    };
    expect(() => mapStoryboardRawToDraft(badRaw, identifierToId)).toThrow();
  });

  test("표지에 등록되지 않은 identifier가 있으면 에러를 던진다", () => {
    const badRaw: StoryboardRaw = { ...raw, cover: { ...raw.cover, characters: ["CHARACTER_Z"] } };
    expect(() => mapStoryboardRawToDraft(badRaw, identifierToId)).toThrow();
  });

  test("여러 캐릭터의 순서가 deterministic하게 유지된다", () => {
    const multiRaw: StoryboardRaw = {
      ...raw,
      panels: [{ ...raw.panels[0], characters: ["CHARACTER_B", "CHARACTER_A"] }],
    };
    const draft = mapStoryboardRawToDraft(multiRaw, identifierToId);
    expect(draft.panels[1].character_ids).toEqual([FIRST_ID, MOM_ID]);
  });

  test("같은 캐릭터가 여러 panel에 재사용돼도 항상 같은 character_id로 변환된다", () => {
    const repeatedRaw: StoryboardRaw = {
      ...raw,
      panels: [
        { ...raw.panels[0], panel_number: 1, characters: ["CHARACTER_A"] },
        { ...raw.panels[0], panel_number: 2, characters: ["CHARACTER_A"] },
      ],
    };
    const draft = mapStoryboardRawToDraft(repeatedRaw, identifierToId);
    expect(draft.panels[1].character_ids).toEqual([MOM_ID]);
    expect(draft.panels[2].character_ids).toEqual([MOM_ID]);
  });
});
