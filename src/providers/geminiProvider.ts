import type {
  ImageProvider,
  GeneratePanelInput,
  GeneratePanelResult,
  GenerateCharacterSheetInput,
  GenerateCharacterSheetResult,
} from "./ImageProvider.js";
import { generateWithGemini, GEMINI_MODEL } from "./gemini.js";
import type { SceneDefinition } from "../types.js";

export const geminiProvider: ImageProvider = {
  id: "gemini",

  async generatePanel({ sceneId, scenePrompt, characters }: GeneratePanelInput): Promise<GeneratePanelResult> {
    const scene: SceneDefinition = {
      scene_id: sceneId,
      title_ko: sceneId,
      character_ids: characters.map((c) => c.character_id),
      prompt: scenePrompt,
    };
    const imageBuffer = await generateWithGemini(characters, scene);
    return { imageBuffer, provider: "gemini", model: GEMINI_MODEL };
  },

  async generateCharacterSheet({
    character,
    poses,
  }: GenerateCharacterSheetInput): Promise<GenerateCharacterSheetResult> {
    const scene: SceneDefinition = {
      scene_id: `character-sheet-${character.character_id}`,
      title_ko: "캐릭터 기준 시트",
      character_ids: [character.character_id],
      prompt: `캐릭터 기준 시트: 한 장의 그리드 이미지 안에 아래 포즈/표정을 각각의 칸으로 나누어 그려주세요 — ${poses.join(
        ", "
      )}. 모든 칸에서 동일 캐릭터, 동일 의상, 동일 그림체를 유지하세요.`,
    };
    const imageBuffer = await generateWithGemini([character], scene);
    return { imageBuffer, provider: "gemini", model: GEMINI_MODEL };
  },
};
