import type { SceneDefinition } from "./types.js";

export const SCENES: SceneDefinition[] = [
  {
    scene_id: "scene-01",
    title_ko: "엄마가 두 아이를 재우는 장면",
    character_ids: ["mom", "first", "second"],
    prompt:
      "어두운 침실, 엄마가 양쪽 팔에 첫째와 둘째를 안고 침대에 앉아 재우는 장면. 은은한 무드등 조명, 평온하고 따뜻한 분위기.",
  },
  {
    scene_id: "scene-02",
    title_ko: "육퇴 후 엄마가 혼자 기뻐하는 장면",
    character_ids: ["mom"],
    prompt:
      "거실 소파에서 엄마 혼자 두 팔을 번쩍 들고 활짝 웃으며 기뻐하는 장면. 배경에 꺼진 티비와 어질러진 장난감들, 늦은 밤 분위기.",
  },
  {
    scene_id: "scene-03",
    title_ko: "휴대폰을 보고 엄마가 당황하는 장면",
    character_ids: ["mom"],
    prompt:
      "엄마가 휴대폰 화면을 보며 눈이 커지고 입을 살짝 벌린 채 당황한 표정을 짓는 장면. 식탁에 앉아있는 구도, 클로즈업 상반신.",
  },
  {
    scene_id: "scene-04",
    title_ko: "엄마가 노트북으로 작업하는 장면",
    character_ids: ["mom"],
    prompt:
      "엄마가 책상에 앉아 노트북 화면을 진지하게 바라보며 타이핑하는 장면. 옆에는 커피잔, 집중한 표정.",
  },
  {
    scene_id: "scene-05",
    title_ko: "엄마와 두 아이가 놀이터에서 노는 장면",
    character_ids: ["mom", "first", "second"],
    prompt:
      "야외 놀이터, 엄마가 그네를 미는 첫째와 유모차에 탄 둘째와 함께 밝은 햇살 아래 즐겁게 노는 장면. 전신 구도, 밝고 화창한 분위기.",
  },
  {
    scene_id: "scene-06",
    title_ko: "첫째와 둘째가 장난치는 장면",
    character_ids: ["first", "second"],
    prompt:
      "거실 바닥에서 첫째가 장난감 자동차를 들고 둘째 앞에서 신나게 보여주며 장난치는 장면. 둘 다 즐거운 표정, 엄마는 등장하지 않음.",
  },
  {
    scene_id: "scene-07",
    title_ko: "엄마가 멘붕한 장면",
    character_ids: ["mom"],
    prompt:
      "엄마가 양손으로 머리를 감싸 쥐고 눈을 질끈 감은 채 멘붕한 표정을 짓는 장면. 주변에 어질러진 집안 풍경, 클로즈업 상반신.",
  },
  {
    scene_id: "scene-08",
    title_ko: "엄마와 두 아이가 서로 안고 있는 엔딩",
    character_ids: ["mom", "first", "second"],
    prompt:
      "거실에서 엄마가 첫째와 둘째를 양팔로 꼭 안고 셋 다 활짝 웃는 따뜻한 엔딩 장면. 정면 구도, 밝고 포근한 분위기.",
  },
];
