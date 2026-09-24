"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { createAdminClient } from "../supabase/admin";
import { getCharacter, listReferences } from "./service";
import { getCharacterSheetProvider } from "../../src/providers/characterSheetProviderRegistry";
import { buildCharacterSheetPrompt } from "../../src/providers/characterSheetPromptBuilder";
import { getToonStyle } from "../../src/providers/characterSheetStyle";
import { characterHasSavedBible, toBibleForPrompt } from "./bibleUtils";
import { getGenerationErrorMessage } from "../projects/generationError";

const REFERENCES_BUCKET = "toon-references";
const SHEETS_BUCKET = "toon-character-sheets";
const MAX_REFERENCE_IMAGES_FOR_SHEET = 3; // 대표 + 최대 2장

/** 동일 캐릭터에 대한 Character Sheet 생성 중복 요청 방지 (STEP 3와 동일한 패턴). */
const inFlightGeneration = new Set<string>();

export interface CharacterSheetView {
  id: string;
  status: "candidate" | "approved" | "rejected";
  storagePath: string;
  signedUrl: string | null;
  generationVersion: number;
  createdAt: string;
}

export interface GenerateCharacterSheetState {
  ok: boolean;
  message?: string;
  sheet?: CharacterSheetView;
}

async function requireOwnedCharacter(characterId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." as const };

  // getCharacter는 RLS로 스코프되므로 남의 character_id면 null이 되어
  // 별도 소유권 비교 없이 타인 캐릭터 요청이 차단된다.
  const character = await getCharacter(supabase, characterId);
  if (!character) return { error: "캐릭터를 찾을 수 없거나 접근 권한이 없습니다." as const };

  return { supabase, user, character };
}

function logSheetGeneration(entry: {
  characterId: string;
  provider: string;
  status: "success" | "failed";
  durationMs: number;
  errorType?: string;
}) {
  console.log(
    `[character-sheet] character=${entry.characterId} provider=${entry.provider} status=${entry.status} duration=${entry.durationMs}ms${
      entry.errorType ? ` errorType=${entry.errorType}` : ""
    }`
  );
}

export async function generateCharacterSheetAction(characterId: string): Promise<GenerateCharacterSheetState> {
  const owned = await requireOwnedCharacter(characterId);
  if ("error" in owned) return { ok: false, message: owned.error };
  const { supabase, user, character } = owned;

  if (!characterHasSavedBible(character)) {
    return {
      ok: false,
      message: "먼저 Character Bible을 분석하고 저장해주세요 (헤어스타일/머리색/얼굴 특징/체형이 필요합니다).",
    };
  }

  if (inFlightGeneration.has(characterId)) {
    return { ok: false, message: "이미 이 캐릭터의 Character Sheet를 생성하고 있습니다. 잠시만 기다려주세요." };
  }
  inFlightGeneration.add(characterId);

  const startedAt = Date.now();
  let generationId: string | null = null;

  try {
    const allReferences = await listReferences(supabase, characterId);
    if (allReferences.length === 0) {
      return { ok: false, message: "참조 사진이 없습니다. 먼저 사진을 등록해주세요." };
    }

    // 대표 사진을 최우선으로, 추가로 최대 2장만 사용한다 (비용/노이즈/배경-소품
    // 오염 위험을 줄이기 위해 5장을 전부 보내지 않는다 — STEP 4 §5).
    const sortedReferences = [...allReferences].sort((a, b) => {
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
      return a.sort_order - b.sort_order;
    });
    const chosenReferences = sortedReferences.slice(0, MAX_REFERENCE_IMAGES_FOR_SHEET);

    const referenceImages = await Promise.all(
      chosenReferences.map(async (ref) => {
        const { data, error } = await supabase.storage.from(REFERENCES_BUCKET).download(ref.storage_path);
        if (error || !data) throw new Error("참조 사진을 불러오지 못했습니다.");
        return { bytes: new Uint8Array(await data.arrayBuffer()), mimeType: data.type || "image/jpeg" };
      })
    );

    const bible = toBibleForPrompt(character);
    const style = getToonStyle();
    const prompt = buildCharacterSheetPrompt({
      characterBible: bible,
      style: style.prompt,
      referenceCount: referenceImages.length,
    });

    const provider = getCharacterSheetProvider();

    const { data: genRow, error: genInsertErr } = await supabase
      .from("toon_generations")
      .insert({
        user_id: user.id,
        generation_type: "character_sheet",
        provider: provider.id,
        model: "pending",
        status: "pending",
        image_count: 0,
      })
      .select("id")
      .single();
    if (genInsertErr) throw new Error("생성 로그를 기록하지 못했습니다.");
    generationId = genRow.id;

    const result = await provider.generate(prompt, referenceImages);

    const storagePath = `${user.id}/${characterId}/${generationId}/sheet.png`;
    const { error: uploadErr } = await supabase.storage
      .from(SHEETS_BUCKET)
      .upload(storagePath, result.imageBytes, { contentType: "image/png", upsert: false });
    if (uploadErr) throw new Error("Character Sheet 저장에 실패했습니다.");

    const { count: existingCount } = await supabase
      .from("toon_character_sheets")
      .select("id", { count: "exact", head: true })
      .eq("character_id", characterId);
    const generationVersion = (existingCount ?? 0) + 1;

    const { data: sheetRow, error: sheetInsertErr } = await supabase
      .from("toon_character_sheets")
      .insert({
        character_id: characterId,
        generation_id: generationId,
        provider: result.provider,
        model: result.model,
        status: "candidate",
        storage_path: storagePath,
        generation_version: generationVersion,
        character_bible_snapshot: bible,
      })
      .select()
      .single();
    if (sheetInsertErr) throw new Error("Character Sheet 기록 저장에 실패했습니다.");

    // toon_generations는 클라이언트(anon+RLS)용 update 정책이 의도적으로
    // 없다(STEP 1) — 상태 전이는 신뢰된 서버 코드에서만, service_role로만
    // 수행한다.
    const { error: markSuccessErr } = await createAdminClient()
      .from("toon_generations")
      .update({ status: "success", model: result.model, image_count: 1 })
      .eq("id", generationId);
    if (markSuccessErr) {
      console.error("[character-sheet] generation 상태 갱신 실패:", markSuccessErr.message);
    }

    logSheetGeneration({
      characterId,
      provider: result.provider,
      status: "success",
      durationMs: Date.now() - startedAt,
    });

    const { data: signed } = await supabase.storage.from(SHEETS_BUCKET).createSignedUrl(storagePath, 3600);

    revalidatePath(`/toon/characters/${characterId}`);

    return {
      ok: true,
      sheet: {
        id: sheetRow.id,
        status: sheetRow.status,
        storagePath: sheetRow.storage_path,
        signedUrl: signed?.signedUrl ?? null,
        generationVersion: sheetRow.generation_version,
        createdAt: sheetRow.created_at,
      },
    };
  } catch (e) {
    if (generationId) {
      const { error: markFailedErr } = await createAdminClient()
        .from("toon_generations")
        .update({ status: "failed", error_message: e instanceof Error ? e.message.slice(0, 300) : "unknown" })
        .eq("id", generationId);
      if (markFailedErr) {
        console.error("[character-sheet] generation 실패 상태 기록 실패:", markFailedErr.message);
      }
    }
    logSheetGeneration({
      characterId,
      provider: "unknown",
      status: "failed",
      durationMs: Date.now() - startedAt,
      errorType: e instanceof Error ? e.constructor.name : "Unknown",
    });
    return {
      ok: false,
      message: getGenerationErrorMessage(e, "Character Sheet 생성 중 오류가 발생했습니다."),
    };
  } finally {
    inFlightGeneration.delete(characterId);
  }
}

export async function approveCharacterSheetAction(
  characterId: string,
  sheetId: string
): Promise<{ ok: boolean; message?: string }> {
  const owned = await requireOwnedCharacter(characterId);
  if ("error" in owned) return { ok: false, message: owned.error };
  const { supabase } = owned;

  const { data: targetSheet, error: fetchErr } = await supabase
    .from("toon_character_sheets")
    .select("id, storage_path, character_id")
    .eq("id", sheetId)
    .eq("character_id", characterId)
    .maybeSingle();
  if (fetchErr || !targetSheet) {
    return { ok: false, message: "승인할 Character Sheet를 찾을 수 없습니다." };
  }

  // 기존 approved를 먼저 내리고(유니크 인덱스 충돌 방지), 새 후보를 승인한다.
  const { error: demoteErr } = await supabase
    .from("toon_character_sheets")
    .update({ status: "rejected" })
    .eq("character_id", characterId)
    .eq("status", "approved");
  if (demoteErr) return { ok: false, message: "기존 Character Sheet 상태 변경에 실패했습니다." };

  const { error: approveErr } = await supabase
    .from("toon_character_sheets")
    .update({ status: "approved" })
    .eq("id", sheetId);
  if (approveErr) return { ok: false, message: "승인 처리에 실패했습니다." };

  const { error: charUpdateErr } = await supabase
    .from("toon_characters")
    .update({ character_sheet_url: targetSheet.storage_path })
    .eq("id", characterId);
  if (charUpdateErr) return { ok: false, message: "캐릭터 정보 갱신에 실패했습니다." };

  revalidatePath(`/toon/characters/${characterId}`);
  return { ok: true };
}

export async function getCharacterSheetsView(characterId: string): Promise<{
  approved: CharacterSheetView | null;
  latestCandidate: CharacterSheetView | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("toon_character_sheets")
    .select("*")
    .eq("character_id", characterId)
    .order("created_at", { ascending: false });

  if (error || !data) return { approved: null, latestCandidate: null };

  const toView = async (row: {
    id: string;
    status: "candidate" | "approved" | "rejected";
    storage_path: string;
    generation_version: number;
    created_at: string;
  }): Promise<CharacterSheetView> => {
    const { data: signed } = await supabase.storage.from(SHEETS_BUCKET).createSignedUrl(row.storage_path, 3600);
    return {
      id: row.id,
      status: row.status,
      storagePath: row.storage_path,
      signedUrl: signed?.signedUrl ?? null,
      generationVersion: row.generation_version,
      createdAt: row.created_at,
    };
  };

  const approvedRow = data.find((r) => r.status === "approved");
  const candidateRow = data.find((r) => r.status === "candidate");

  return {
    approved: approvedRow ? await toView(approvedRow) : null,
    latestCandidate: candidateRow ? await toView(candidateRow) : null,
  };
}
