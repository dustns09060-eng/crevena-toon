"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import {
  createSeries,
  getSeries,
  getSeriesCharacters,
  getSeriesList,
  linkCharacterToSeries,
  unlinkCharacterFromSeries,
} from "./service";
import { getCharacter } from "../characters/service";
import type { ToonCharacter, ToonSeries } from "../../src/db/types";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." as const };
  return { supabase, user };
}

export interface CreateSeriesState {
  ok: boolean;
  message?: string;
  series?: ToonSeries;
}

export async function createSeriesAction(title: string): Promise<CreateSeriesState> {
  const owned = await requireUser();
  if ("error" in owned) return { ok: false, message: owned.error };

  const trimmed = title.trim();
  if (trimmed.length === 0) return { ok: false, message: "시리즈 제목을 입력해주세요." };
  if (trimmed.length > 80) return { ok: false, message: "시리즈 제목은 80자 이내로 입력해주세요." };

  try {
    const series = await createSeries(owned.supabase, trimmed);
    revalidatePath("/toon/series");
    return { ok: true, series };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "시리즈 생성 중 오류가 발생했습니다." };
  }
}

export async function listSeriesAction(): Promise<ToonSeries[]> {
  const owned = await requireUser();
  if ("error" in owned) return [];
  return getSeriesList(owned.supabase);
}

export async function listSeriesCharactersAction(seriesId: string): Promise<ToonCharacter[]> {
  const owned = await requireUser();
  if ("error" in owned) return [];

  // getSeries는 RLS로 스코프되므로 남의 series_id면 null이 되어
  // 별도 소유권 비교 없이 타인 시리즈 요청이 차단된다.
  const series = await getSeries(owned.supabase, seriesId);
  if (!series) return [];

  return getSeriesCharacters(owned.supabase, seriesId);
}

export interface LinkCharacterState {
  ok: boolean;
  message?: string;
}

/**
 * 이미 존재하는 캐릭터(Character Bible/Character Sheet 그대로)를
 * 시리즈에 연결한다. 캐릭터를 새로 만들거나 Character Sheet를
 * 재생성하지 않는다 — 오직 toon_series_characters 조인 행만 추가한다.
 */
export async function linkCharacterToSeriesAction(seriesId: string, characterId: string): Promise<LinkCharacterState> {
  const owned = await requireUser();
  if ("error" in owned) return { ok: false, message: owned.error };
  const { supabase } = owned;

  const series = await getSeries(supabase, seriesId);
  if (!series) return { ok: false, message: "시리즈를 찾을 수 없거나 접근 권한이 없습니다." };

  // getCharacter도 RLS로 스코프되므로 남의 character_id면 null이 되어
  // 별도 소유권 비교 없이 타인 캐릭터 연결 시도가 차단된다.
  const character = await getCharacter(supabase, characterId);
  if (!character) return { ok: false, message: "캐릭터를 찾을 수 없거나 접근 권한이 없습니다." };

  try {
    await linkCharacterToSeries(supabase, seriesId, characterId);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "캐릭터 연결에 실패했습니다." };
  }

  revalidatePath(`/toon/series/${seriesId}`);
  return { ok: true };
}

export async function unlinkCharacterFromSeriesAction(seriesId: string, characterId: string): Promise<LinkCharacterState> {
  const owned = await requireUser();
  if ("error" in owned) return { ok: false, message: owned.error };
  const { supabase } = owned;

  const series = await getSeries(supabase, seriesId);
  if (!series) return { ok: false, message: "시리즈를 찾을 수 없거나 접근 권한이 없습니다." };

  try {
    await unlinkCharacterFromSeries(supabase, seriesId, characterId);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "캐릭터 연결 해제에 실패했습니다." };
  }

  revalidatePath(`/toon/series/${seriesId}`);
  return { ok: true };
}
