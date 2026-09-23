import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToonCharacter, ToonSeries } from "../../src/db/types";

export async function createSeries(supabase: SupabaseClient, title: string): Promise<ToonSeries> {
  const { data, error } = await supabase.from("toon_series").insert({ title }).select().single();
  if (error) throw error;
  return data as ToonSeries;
}

export async function getSeriesList(supabase: SupabaseClient): Promise<ToonSeries[]> {
  const { data, error } = await supabase.from("toon_series").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ToonSeries[];
}

export async function getSeries(supabase: SupabaseClient, seriesId: string): Promise<ToonSeries | null> {
  const { data, error } = await supabase.from("toon_series").select("*").eq("id", seriesId).maybeSingle();
  if (error) throw error;
  return data as ToonSeries | null;
}

/**
 * 이 시리즈에 연결된 캐릭터 목록(= "Series Character Set"). 캐릭터
 * 실체는 여전히 toon_characters(사용자 전역 풀)에 있고, 여기서는
 * toon_series_characters 조인 결과만 캐릭터 전체 필드로 펼쳐서 준다.
 */
export async function getSeriesCharacters(supabase: SupabaseClient, seriesId: string): Promise<ToonCharacter[]> {
  const { data, error } = await supabase
    .from("toon_series_characters")
    .select("toon_characters(*)")
    .eq("series_id", seriesId);
  if (error) throw error;

  return (data ?? [])
    .map((row: { toon_characters: ToonCharacter | ToonCharacter[] | null }) =>
      Array.isArray(row.toon_characters) ? row.toon_characters[0] : row.toon_characters
    )
    .filter((c): c is ToonCharacter => Boolean(c));
}

/**
 * 이미 존재하는(승인된 Character Sheet가 있을 수도, 없을 수도 있는)
 * character_id를 시리즈에 연결한다. 이 함수는 캐릭터를 새로 만들거나
 * Character Bible/Character Sheet를 재생성하지 않는다 — 오직
 * toon_series_characters 조인 행 하나만 추가한다.
 */
export async function linkCharacterToSeries(
  supabase: SupabaseClient,
  seriesId: string,
  characterId: string
): Promise<void> {
  const { error } = await supabase
    .from("toon_series_characters")
    .insert({ series_id: seriesId, character_id: characterId });
  if (error) throw error;
}

export async function unlinkCharacterFromSeries(
  supabase: SupabaseClient,
  seriesId: string,
  characterId: string
): Promise<void> {
  const { error } = await supabase
    .from("toon_series_characters")
    .delete()
    .eq("series_id", seriesId)
    .eq("character_id", characterId);
  if (error) throw error;
}
