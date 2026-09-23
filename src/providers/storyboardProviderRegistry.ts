import type { StoryboardProvider } from "./StoryboardProvider";
import { geminiStoryboardProvider } from "./geminiStoryboardProvider";

export const DEFAULT_STORYBOARD_PROVIDER_ID = process.env.STORYBOARD_PROVIDER_ID ?? "gemini";

export const STORYBOARD_PROVIDERS: Record<string, StoryboardProvider> = {
  gemini: geminiStoryboardProvider,
};

export function getStoryboardProvider(id: string = DEFAULT_STORYBOARD_PROVIDER_ID): StoryboardProvider {
  const provider = STORYBOARD_PROVIDERS[id];
  if (!provider) throw new Error(`알 수 없는 Storyboard 프로바이더: ${id}`);
  return provider;
}
