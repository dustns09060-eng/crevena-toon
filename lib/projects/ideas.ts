"use server";

import { createClient } from "../supabase/server";
import { getStoryboardProvider } from "../../src/providers/storyboardProviderRegistry";
import type { StoryIdea } from "../../src/providers/storyboardSchema";

const inFlightIdeaRequests = new Set<string>();

export interface GenerateIdeasState {
  ok: boolean;
  message?: string;
  ideas?: StoryIdea[];
}

export async function generateIdeasAction(characterIds: string[]): Promise<GenerateIdeasState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "로그인이 필요합니다." };

  if (characterIds.length === 0) {
    return { ok: false, message: "캐릭터를 최소 1명 선택해주세요." };
  }

  if (inFlightIdeaRequests.has(user.id)) {
    return { ok: false, message: "이미 소재를 추천받고 있습니다. 잠시만 기다려주세요." };
  }
  inFlightIdeaRequests.add(user.id);

  try {
    // RLS로 스코프된 조회이므로, 요청한 id 중 본인 소유가 아닌 것이 있으면
    // 그만큼 적게 반환된다 — 개수 불일치로 감지해 거부한다.
    const { data: characters, error } = await supabase
      .from("toon_characters")
      .select("id, display_name, role, personality, speaking_style")
      .in("id", characterIds);
    if (error) throw error;

    if (!characters || characters.length !== characterIds.length) {
      return { ok: false, message: "본인 소유가 아닌 캐릭터가 포함되어 있습니다." };
    }

    const provider = getStoryboardProvider();
    const ideas = await provider.generateIdeas({
      characters: characters.map((c: { display_name: string; role: string; personality: string | null; speaking_style: string | null }) => ({
        display_name: c.display_name,
        role: c.role,
        personality: c.personality,
        speaking_style: c.speaking_style,
      })),
    });

    return { ok: true, ideas };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "소재 추천 중 오류가 발생했습니다." };
  } finally {
    inFlightIdeaRequests.delete(user.id);
  }
}
