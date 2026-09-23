import { generateImageFromPrompt, GEMINI_MODEL } from "./gemini";
import type { CharacterSheetProvider, GenerateFromPromptResult, ReferenceImageBytes } from "./CharacterSheetProvider";

export const geminiCharacterSheetProvider: CharacterSheetProvider = {
  id: "gemini",

  async generate(prompt: string, referenceImages: ReferenceImageBytes[]): Promise<GenerateFromPromptResult> {
    const imageBytes = await generateImageFromPrompt(prompt, referenceImages);
    return { imageBytes, provider: "gemini", model: GEMINI_MODEL };
  },
};
