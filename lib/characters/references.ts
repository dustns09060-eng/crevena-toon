import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToonCharacterReference, ToonCharacterReferenceVariant } from "../../src/db/types";
import { buildReferenceStoragePath, validatePhotoFile, type PhotoFileInput } from "./photoValidation";

const REFERENCES_BUCKET = "toon-references";

export interface UploadReferenceInput extends PhotoFileInput {
  isPrimary?: boolean;
  variant?: ToonCharacterReferenceVariant;
}

export async function uploadReferenceImage(
  supabase: SupabaseClient,
  userId: string,
  characterId: string,
  input: UploadReferenceInput
): Promise<ToonCharacterReference> {
  const validation = validatePhotoFile(input);
  if (!validation.valid) {
    throw new Error(validation.reason);
  }

  const storagePath = buildReferenceStoragePath(userId, characterId, validation.format);

  const { error: uploadErr } = await supabase.storage
    .from(REFERENCES_BUCKET)
    .upload(storagePath, input.bytes, {
      contentType: input.declaredMimeType,
      upsert: false,
    });
  if (uploadErr) throw uploadErr;

  const isPrimary = input.isPrimary ?? false;
  if (isPrimary) {
    await unsetExistingPrimary(supabase, characterId);
  }

  const { data: existing, error: countErr } = await supabase
    .from("toon_character_references")
    .select("sort_order")
    .eq("character_id", characterId)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (countErr) throw countErr;
  const nextSortOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;

  const { data, error: insertErr } = await supabase
    .from("toon_character_references")
    .insert({
      character_id: characterId,
      variant: input.variant ?? "original",
      storage_path: storagePath,
      is_primary: isPrimary,
      sort_order: nextSortOrder,
    })
    .select()
    .single();

  if (insertErr) {
    // DB insert가 실패하면 이미 업로드된 Storage 객체가 고아로 남지 않도록 정리한다.
    await supabase.storage.from(REFERENCES_BUCKET).remove([storagePath]);
    throw insertErr;
  }

  return data as ToonCharacterReference;
}

async function unsetExistingPrimary(supabase: SupabaseClient, characterId: string) {
  const { error } = await supabase
    .from("toon_character_references")
    .update({ is_primary: false })
    .eq("character_id", characterId)
    .eq("is_primary", true);
  if (error) throw error;
}

export async function setPrimaryReference(
  supabase: SupabaseClient,
  characterId: string,
  referenceId: string
): Promise<void> {
  await unsetExistingPrimary(supabase, characterId);
  const { error } = await supabase
    .from("toon_character_references")
    .update({ is_primary: true })
    .eq("id", referenceId)
    .eq("character_id", characterId);
  if (error) throw error;
}

export async function deleteReference(
  supabase: SupabaseClient,
  characterId: string,
  referenceId: string
): Promise<void> {
  const { data: ref, error: fetchErr } = await supabase
    .from("toon_character_references")
    .select("storage_path")
    .eq("id", referenceId)
    .eq("character_id", characterId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!ref) return;

  const { error: delErr } = await supabase
    .from("toon_character_references")
    .delete()
    .eq("id", referenceId)
    .eq("character_id", characterId);
  if (delErr) throw delErr;

  await supabase.storage.from(REFERENCES_BUCKET).remove([ref.storage_path]);
}

export async function reorderReferences(
  supabase: SupabaseClient,
  characterId: string,
  orderedReferenceIds: string[]
): Promise<void> {
  for (let i = 0; i < orderedReferenceIds.length; i++) {
    const { error } = await supabase
      .from("toon_character_references")
      .update({ sort_order: i })
      .eq("id", orderedReferenceIds[i])
      .eq("character_id", characterId);
    if (error) throw error;
  }
}
