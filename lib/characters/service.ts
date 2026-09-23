import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToonCharacter, ToonCharacterReference } from "../../src/db/types";
import type { CharacterFormInput } from "./formValidation";

const REFERENCES_BUCKET = "toon-references";
const CHARACTER_SHEETS_BUCKET = "toon-character-sheets";

function buildPlaceholderVisualPrompt(input: CharacterFormInput): string {
  const parts = [input.role, input.display_name, input.representative_outfit, input.personality].filter(
    (v): v is string => Boolean(v && v.trim())
  );
  return parts.join(" · ") || input.display_name;
}

export async function createCharacter(
  supabase: SupabaseClient,
  input: CharacterFormInput
): Promise<ToonCharacter> {
  const { data, error } = await supabase
    .from("toon_characters")
    .insert({
      display_name: input.display_name,
      role: input.role,
      personality: input.personality || null,
      speaking_style: input.speaking_style || null,
      representative_outfit: input.representative_outfit || null,
      // visual_prompt는 STEP 2에서 AI 분석 없이, 사용자가 직접 입력한
      // 정보만으로 구성한 placeholder다 — analyzeCharacterReferences()가
      // 붙으면 이 값을 정식 visual_prompt로 대체한다.
      visual_prompt: buildPlaceholderVisualPrompt(input),
    })
    .select()
    .single();

  if (error) throw error;
  return data as ToonCharacter;
}

export async function updateCharacter(
  supabase: SupabaseClient,
  characterId: string,
  input: CharacterFormInput
): Promise<ToonCharacter> {
  const { data, error } = await supabase
    .from("toon_characters")
    .update({
      display_name: input.display_name,
      role: input.role,
      personality: input.personality || null,
      speaking_style: input.speaking_style || null,
      representative_outfit: input.representative_outfit || null,
    })
    .eq("id", characterId)
    .select()
    .single();

  if (error) throw error;
  return data as ToonCharacter;
}

export async function getCharacters(supabase: SupabaseClient): Promise<ToonCharacter[]> {
  const { data, error } = await supabase
    .from("toon_characters")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as ToonCharacter[];
}

export async function getCharacter(
  supabase: SupabaseClient,
  characterId: string
): Promise<ToonCharacter | null> {
  const { data, error } = await supabase
    .from("toon_characters")
    .select("*")
    .eq("id", characterId)
    .maybeSingle();

  if (error) throw error;
  return data as ToonCharacter | null;
}

export type DeleteCharacterResult =
  | { deleted: true }
  | { deleted: false; reason: "linked_to_projects"; projectCount: number };

export async function deleteCharacter(
  supabase: SupabaseClient,
  characterId: string
): Promise<DeleteCharacterResult> {
  const { count, error: linkErr } = await supabase
    .from("toon_project_characters")
    .select("project_id", { count: "exact", head: true })
    .eq("character_id", characterId);
  if (linkErr) throw linkErr;

  if ((count ?? 0) > 0) {
    return { deleted: false, reason: "linked_to_projects", projectCount: count ?? 0 };
  }

  const { data: refs, error: refErr } = await supabase
    .from("toon_character_references")
    .select("storage_path")
    .eq("character_id", characterId);
  if (refErr) throw refErr;

  if (refs && refs.length > 0) {
    const paths = refs.map((r: { storage_path: string }) => r.storage_path);
    const { error: removeErr } = await supabase.storage.from(REFERENCES_BUCKET).remove(paths);
    if (removeErr) throw removeErr;
  }

  // STEP 4 — Character Sheet 파일도 정리한다 (FK CASCADE는 DB row만 지우고
  // 실제 Storage 객체는 지우지 않으므로, 여기서 명시적으로 삭제해야 한다).
  const { data: sheets, error: sheetsErr } = await supabase
    .from("toon_character_sheets")
    .select("storage_path")
    .eq("character_id", characterId);
  if (sheetsErr) throw sheetsErr;

  if (sheets && sheets.length > 0) {
    const sheetPaths = sheets.map((s: { storage_path: string }) => s.storage_path);
    const { error: removeSheetsErr } = await supabase.storage.from(CHARACTER_SHEETS_BUCKET).remove(sheetPaths);
    if (removeSheetsErr) throw removeSheetsErr;
  }

  const { error: delErr } = await supabase.from("toon_characters").delete().eq("id", characterId);
  if (delErr) throw delErr;

  return { deleted: true };
}

export async function getPrimaryReferenceSignedUrl(
  supabase: SupabaseClient,
  characterId: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  const { data, error } = await supabase
    .from("toon_character_references")
    .select("storage_path")
    .eq("character_id", characterId)
    .eq("is_primary", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { data: signed, error: signErr } = await supabase.storage
    .from(REFERENCES_BUCKET)
    .createSignedUrl(data.storage_path, expiresInSeconds);
  if (signErr) return null;
  return signed.signedUrl;
}

export async function getReferenceSignedUrl(
  supabase: SupabaseClient,
  storagePath: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(REFERENCES_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error) return null;
  return data.signedUrl;
}

export async function listReferences(
  supabase: SupabaseClient,
  characterId: string
): Promise<ToonCharacterReference[]> {
  const { data, error } = await supabase
    .from("toon_character_references")
    .select("*")
    .eq("character_id", characterId)
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return (data ?? []) as ToonCharacterReference[];
}

/**
 * STEP 2 범위 밖 — 아직 구현하지 않는다. 향후 여기에 사진 기반
 * 얼굴/헤어/체형 분석(유료 AI 호출)을 붙여 visual_prompt를 자동으로
 * 채우게 될 자리다. 지금은 명확히 실패하도록 만들어 실수로
 * 호출되는 걸 방지한다.
 */
export async function analyzeCharacterReferences(): Promise<never> {
  throw new Error(
    "analyzeCharacterReferences()는 아직 구현되지 않았습니다 (STEP 2 범위 밖 — 유료 AI 분석 미호출)."
  );
}

/**
 * STEP 2 범위 밖 — 아직 구현하지 않는다. 향후 Character Sheet
 * 이미지를 실제로 생성(유료 API 호출)할 자리다.
 */
export async function generateCharacterSheet(): Promise<never> {
  throw new Error(
    "generateCharacterSheet()는 아직 구현되지 않았습니다 (STEP 2 범위 밖 — 유료 이미지 생성 미호출)."
  );
}
