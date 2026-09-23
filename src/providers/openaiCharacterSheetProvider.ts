import { generateImageFromPrompt, OPENAI_MODEL } from "./openai";
import type { CharacterSheetProvider, GenerateFromPromptResult, ReferenceImageBytes } from "./CharacterSheetProvider";

export const openaiCharacterSheetProvider: CharacterSheetProvider = {
  id: "openai",

  async generate(prompt: string, referenceImages: ReferenceImageBytes[]): Promise<GenerateFromPromptResult> {
    const imageBytes = await generateImageFromPrompt(prompt, referenceImages);
    return { imageBytes, provider: "openai", model: OPENAI_MODEL };
  },
};
