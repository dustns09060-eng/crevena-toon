import { describe, expect, test } from "vitest";
import { buildNameToIdMap, mapStoryboardRawToDraft } from "../../src/providers/storyboardMapper";
import type { StoryboardRaw } from "../../src/providers/storyboardSchema";

const characters = [
  { id: "11111111-1111-4111-8111-111111111111", display_name: "엄마" },
  { id: "22222222-2222-4222-8222-222222222222", display_name: "첫째" },
];

const raw: StoryboardRaw = {
  title: "제목",
  summary: "요약",
  panels: [
    {
      panel_number: 1,
      scene_description: "거실",
      characters: ["엄마", "첫째"],
      expressions: ["웃음"],
      actions: ["안아준다"],
      dialogue: [{ character: "엄마", text: "안녕" }],
      narration: "평온한 아침",
      image_prompt: "mother and son in living room",
    },
  ],
};

describe("buildNameToIdMap / mapStoryboardRawToDraft", () => {
  test("display_name을 실제 character_id로 치환한다", () => {
    const map = buildNameToIdMap(characters);
    const draft = mapStoryboardRawToDraft(raw, map);

    expect(draft.panels[0].character_ids).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
    expect(draft.panels[0].dialogue[0].character_id).toBe("11111111-1111-4111-8111-111111111111");
  });

  test("한국어 대사(dialogue.text)와 image_prompt가 서로 분리된 필드로 유지된다", () => {
    const map = buildNameToIdMap(characters);
    const draft = mapStoryboardRawToDraft(raw, map);

    expect(draft.panels[0].dialogue[0].text).toBe("안녕");
    expect(draft.panels[0].image_prompt).toBe("mother and son in living room");
    expect(draft.panels[0].image_prompt).not.toContain("안녕");
  });

  test("expressions와 actions를 하나의 expression 문자열로 합친다", () => {
    const map = buildNameToIdMap(characters);
    const draft = mapStoryboardRawToDraft(raw, map);
    expect(draft.panels[0].expression).toBe("웃음, 안아준다");
  });

  test("알 수 없는 캐릭터 이름이면 에러를 던진다", () => {
    const map = buildNameToIdMap(characters);
    const badRaw: StoryboardRaw = {
      ...raw,
      panels: [{ ...raw.panels[0], characters: ["삼촌"] }],
    };
    expect(() => mapStoryboardRawToDraft(badRaw, map)).toThrow();
  });
});
