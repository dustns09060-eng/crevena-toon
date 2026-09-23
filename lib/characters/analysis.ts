"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { getCharacter, listReferences } from "./service";
import { getCharacterAnalyzer } from "../../src/providers/analyzerRegistry";
import {
  CharacterBibleAnalysisSchema,
  type CharacterBibleAnalysisParsed,
} from "../../src/providers/characterAnalysisSchema";

const REFERENCES_BUCKET = "toon-references";

/**
 * 같은 캐릭터에 대한 분석 요청이 서버에서 동시에 중복 실행되지
 * 않도록 하는 최소한의 가드. 이 프로세스 인스턴스 안에서만
 * 유효하다는 한계가 있다(다중 인스턴스 배포 시에는 큐/락 스토어가
 * 필요) — STEP 3 범위에서는 크레딧 차감이 아직 없으므로 이 정도로
 * 충분하다고 판단했다.
 */
const inFlightAnalysis = new Set<string>();

export interface AnalyzeCharacterState {
  ok: boolean;
  message?: string;
  result?: CharacterBibleAnalysisParsed;
}

async function requireOwnedCharacter(characterId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "로그인이 필요합니다." as const };
  }

  // getCharacter는 RLS(auth.uid() = user_id)로 스코프되므로, 남의
  // character_id를 넘기면 여기서 자연스럽게 null(=찾을 수 없음)이
  // 되어 별도 소유권 비교 로직 없이도 타인 캐릭터 분석 요청이 차단된다.
  const character = await getCharacter(supabase, characterId);
  if (!character) {
    return { error: "캐릭터를 찾을 수 없거나 접근 권한이 없습니다." as const };
  }

  return { supabase, user, character };
}

export async function analyzeCharacterAction(characterId: string): Promise<AnalyzeCharacterState> {
  const owned = await requireOwnedCharacter(characterId);
  if ("error" in owned) return { ok: false, message: owned.error };
  const { supabase, character } = owned;

  if (inFlightAnalysis.has(characterId)) {
    return { ok: false, message: "이미 이 캐릭터에 대한 분석이 진행 중입니다. 잠시만 기다려주세요." };
  }
  inFlightAnalysis.add(characterId);

  const startedAt = Date.now();
  try {
    const references = await listReferences(supabase, characterId);
    if (references.length === 0) {
      return { ok: false, message: "분석할 참조 사진이 없습니다. 먼저 사진을 등록해주세요." };
    }

    const images = await Promise.all(
      references.map(async (ref) => {
        const { data, error } = await supabase.storage.from(REFERENCES_BUCKET).download(ref.storage_path);
        if (error || !data) {
          throw new Error("참조 사진을 불러오지 못했습니다.");
        }
        const bytes = new Uint8Array(await data.arrayBuffer());
        return { bytes, mimeType: data.type || "image/jpeg" };
      })
    );

    const analyzer = getCharacterAnalyzer();
    const rawResult = await analyzer.analyzeCharacter({
      referenceImages: images,
      existingCharacterData: {
        display_name: character.display_name,
        role: character.role ?? "",
        age_group: character.age_group,
        personality: character.personality,
        representative_outfit: character.representative_outfit,
      },
    });

    // 프로바이더 구현체가 이미 zod로 검증했지만, 서버 액션 경계에서도
    // 한 번 더 검증한다 (defense-in-depth — 프로바이더 구현이 바뀌어도 안전).
    const revalidated = CharacterBibleAnalysisSchema.safeParse(rawResult);
    if (!revalidated.success) {
      logAnalysis({ characterId, provider: analyzer.id, status: "failed", durationMs: Date.now() - startedAt });
      return { ok: false, message: "AI 분석 결과가 유효하지 않아 저장하지 않았습니다." };
    }

    logAnalysis({ characterId, provider: analyzer.id, status: "success", durationMs: Date.now() - startedAt });
    return { ok: true, result: revalidated.data };
  } catch (e) {
    logAnalysis({
      characterId,
      provider: "unknown",
      status: "failed",
      durationMs: Date.now() - startedAt,
      errorType: e instanceof Error ? e.constructor.name : "Unknown",
    });
    return {
      ok: false,
      message: e instanceof Error ? e.message : "분석 중 오류가 발생했습니다.",
    };
  } finally {
    inFlightAnalysis.delete(characterId);
  }
}

export interface SaveCharacterBibleState {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
}

/** 사용자가 (필요하면 수정한) 분석 결과를 검토 후 승인해 실제로 저장한다. */
export async function saveCharacterBibleAction(
  characterId: string,
  input: unknown
): Promise<SaveCharacterBibleState> {
  const owned = await requireOwnedCharacter(characterId);
  if ("error" in owned) return { ok: false, message: owned.error };
  const { supabase } = owned;

  const validation = CharacterBibleAnalysisSchema.safeParse(input);
  if (!validation.success) {
    const errors: Record<string, string> = {};
    for (const issue of validation.error.issues) {
      const key = issue.path.join(".") || "form";
      if (!errors[key]) errors[key] = issue.message;
    }
    return { ok: false, errors, message: "입력값을 확인해주세요." };
  }

  const data = validation.data;
  const { error } = await supabase
    .from("toon_characters")
    .update({
      hairstyle: data.hairstyle,
      hair_color: data.hair_color,
      face_features: data.face_features,
      body_type: data.body_type,
      representative_outfit: data.representative_outfit,
      distinctive_features: data.distinctive_features ?? null,
      visual_prompt: data.visual_prompt,
      negative_constraints: data.negative_constraints,
    })
    .eq("id", characterId);

  if (error) {
    return { ok: false, message: "저장 중 오류가 발생했습니다: " + error.message };
  }

  revalidatePath(`/toon/characters/${characterId}`);
  return { ok: true };
}

/**
 * 분석 성공/실패 로그. API key, 이미지 바이트, Storage 경로/서명 URL,
 * 사진 내용 등 민감정보는 절대 남기지 않는다 — characterId(불투명
 * UUID)와 처리 결과/소요시간만 기록한다.
 */
function logAnalysis(entry: {
  characterId: string;
  provider: string;
  status: "success" | "failed";
  durationMs: number;
  errorType?: string;
}) {
  console.log(
    `[character-analysis] character=${entry.characterId} provider=${entry.provider} status=${entry.status} duration=${entry.durationMs}ms${
      entry.errorType ? ` errorType=${entry.errorType}` : ""
    }`
  );
}
