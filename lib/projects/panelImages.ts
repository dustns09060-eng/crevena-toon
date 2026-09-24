"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { createAdminClient } from "../supabase/admin";
import { getProject, getProjectPanels } from "./service";
import { getCharacter } from "../characters/service";
import { characterHasSavedBible, toBibleForPrompt } from "../characters/bibleUtils";
import { getCharacterSheetProvider } from "../../src/providers/characterSheetProviderRegistry";
import { buildPanelImagePrompt, COVER_COMPOSITION_NOTE } from "../../src/providers/panelImagePromptBuilder";
import { getToonStyle } from "../../src/providers/characterSheetStyle";
import { DEFAULT_PANEL_ASPECT_RATIO } from "../../src/providers/panelImageConfig";
import { MAX_CHARACTERS_PER_PANEL } from "../../src/providers/projectPanelCountConfig";
import { getLocation } from "../locations/service";
import { getProjectLocation } from "./projectLocations";
import { buildPanelImageEditPrompt } from "../../src/providers/panelImageEditPromptBuilder";
import type { ToonCharacter, ToonPanel, ToonProject, ToonTimeOfDay } from "../../src/db/types";

const REFERENCES_SHEET_BUCKET = "toon-character-sheets";
const PANELS_BUCKET = "toon-panels";

const inFlightPanelGeneration = new Set<string>();

export interface PanelImageView {
  id: string;
  status: "candidate" | "approved" | "rejected";
  signedUrl: string | null;
  generationVersion: number;
}

export interface GeneratePanelImageState {
  ok: boolean;
  message?: string;
  image?: PanelImageView;
}

async function requireOwnedPanel(panelId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." as const };

  const { data: panel, error } = await supabase
    .from("toon_panels")
    .select("*")
    .eq("id", panelId)
    .maybeSingle();
  if (error) return { error: "패널 조회 중 오류가 발생했습니다." as const };
  if (!panel) return { error: "컷을 찾을 수 없거나 접근 권한이 없습니다." as const };

  const project = await getProject(supabase, (panel as ToonPanel).project_id);
  if (!project) return { error: "컷을 찾을 수 없거나 접근 권한이 없습니다." as const };

  return { supabase, user, panel: panel as ToonPanel, project };
}

export interface ReadinessResult {
  ready: boolean;
  errors: string[];
}

/**
 * STEP 6 §1 — 이미지 생성을 시작하기 전 반드시 만족해야 하는 조건.
 * 페이지 로드 시(사전 안내용)와 실제 생성 액션 시작 시(진짜 방어선)
 * 양쪽에서 재사용한다.
 */
export async function checkProjectGenerationReadiness(
  supabase: Awaited<ReturnType<typeof createClient>>,
  project: ToonProject,
  panels: ToonPanel[]
): Promise<ReadinessResult> {
  const errors: string[] = [];

  if (project.status !== "confirmed") {
    errors.push("프로젝트가 아직 확정(confirmed)되지 않았습니다. 먼저 스토리보드를 확정해주세요.");
  }

  if (panels.length !== project.panel_count) {
    errors.push(`저장된 컷 수(${panels.length})가 프로젝트 컷 수(${project.panel_count})와 다릅니다.`);
  }
  panels.forEach((p, i) => {
    if (p.panel_number !== i + 1) errors.push("panel_number가 1부터 연속되지 않습니다.");
    if (p.character_ids.length > MAX_CHARACTERS_PER_PANEL) {
      errors.push(`컷 ${p.panel_number}에 등장인물이 최대 ${MAX_CHARACTERS_PER_PANEL}명을 초과합니다.`);
    }
  });

  const characterIds = [...new Set(panels.flatMap((p) => p.character_ids))];
  const characters: ToonCharacter[] = [];
  for (const id of characterIds) {
    const c = await getCharacter(supabase, id);
    if (!c) {
      errors.push("스토리보드에 사용된 캐릭터 중 접근할 수 없는 캐릭터가 있습니다.");
      continue;
    }
    characters.push(c);
  }

  for (const c of characters) {
    if (!characterHasSavedBible(c)) {
      errors.push(`'${c.display_name}'의 Character Bible이 저장되지 않았습니다.`);
      continue;
    }
    const { data: sheet } = await supabase
      .from("toon_character_sheets")
      .select("id")
      .eq("character_id", c.id)
      .eq("status", "approved")
      .maybeSingle();
    if (!sheet) {
      errors.push(`'${c.display_name}'의 승인된 Character Sheet가 없습니다.`);
    }
  }

  return { ready: errors.length === 0, errors };
}

function logPanelGeneration(entry: {
  panelId: string;
  provider: string;
  status: "success" | "failed";
  durationMs: number;
  errorType?: string;
}) {
  console.log(
    `[panel-image] panel=${entry.panelId} provider=${entry.provider} status=${entry.status} duration=${entry.durationMs}ms${
      entry.errorType ? ` errorType=${entry.errorType}` : ""
    }`
  );
}

export async function generatePanelImageAction(panelId: string): Promise<GeneratePanelImageState> {
  const owned = await requireOwnedPanel(panelId);
  if ("error" in owned) return { ok: false, message: owned.error };
  const { supabase, user, panel, project } = owned;

  const panels = await getProjectPanels(supabase, project.id);
  const readiness = await checkProjectGenerationReadiness(supabase, project, panels);
  if (!readiness.ready) {
    return { ok: false, message: readiness.errors.join(" / ") };
  }

  if (inFlightPanelGeneration.has(panelId)) {
    return { ok: false, message: "이미 이 컷의 이미지를 생성하고 있습니다. 잠시만 기다려주세요." };
  }
  inFlightPanelGeneration.add(panelId);

  const startedAt = Date.now();
  let generationId: string | null = null;

  try {
    const fullCharacters: ToonCharacter[] = [];
    for (const id of panel.character_ids) {
      const c = await getCharacter(supabase, id);
      if (!c) throw new Error("등장 캐릭터 정보를 불러올 수 없습니다.");
      fullCharacters.push(c);
    }

    const referenceImages = [];
    const promptCharacters = [];
    for (const c of fullCharacters) {
      const { data: sheet } = await supabase
        .from("toon_character_sheets")
        .select("storage_path")
        .eq("character_id", c.id)
        .eq("status", "approved")
        .maybeSingle();
      if (!sheet) throw new Error(`'${c.display_name}'의 승인된 Character Sheet를 찾을 수 없습니다.`);

      const { data: file, error: downloadErr } = await supabase.storage
        .from(REFERENCES_SHEET_BUCKET)
        .download(sheet.storage_path);
      if (downloadErr || !file) throw new Error("Character Sheet 이미지를 불러오지 못했습니다.");

      referenceImages.push({
        bytes: new Uint8Array(await file.arrayBuffer()),
        mimeType: file.type || "image/png",
      });
      promptCharacters.push({ display_name: c.display_name, characterBible: toBibleForPrompt(c) });
    }

    // 021/022 — panel.location_id(Saved) 또는 panel.project_location_id
    // (Temporary, 022) 중 있는 쪽의 Location Bible을 조회해 프롬프트에
    // 전달한다. 둘 다 없으면(레거시/장소 미설정) location을 넘기지 않는다
    // — buildPanelImagePrompt는 이 경우 LOCATION 블록을 아예 생략한다.
    // DB CHECK(toon_panels_location_exclusive)가 둘 다 채워지는 것을
    // 막으므로 여기서는 항상 최대 하나만 값을 가진다.
    let locationContext = null;
    if (panel.location_id) {
      const location = await getLocation(supabase, panel.location_id);
      if (location) {
        locationContext = {
          display_name: location.display_name,
          visual_prompt: location.visual_prompt,
          wall_and_floor: location.wall_and_floor,
          fixed_furniture: location.fixed_furniture,
          window_style: location.window_style,
          recurring_props: location.recurring_props,
          distinctive_features: location.distinctive_features,
        };
      }
      // location이 삭제되어 조회되지 않는 경우(on delete set null이 아직
      // 반영 안 됐거나 타이밍 이슈)는 조용히 무시하고 location 없이
      // 진행한다 — 생성 자체를 막을 이유는 없다(장소는 부가 정보).
    } else if (panel.project_location_id) {
      const projectLocation = await getProjectLocation(supabase, panel.project_location_id);
      if (projectLocation) {
        locationContext = {
          display_name: projectLocation.display_name,
          visual_prompt: projectLocation.visual_prompt,
          wall_and_floor: projectLocation.wall_and_floor,
          fixed_furniture: projectLocation.fixed_furniture,
          window_style: projectLocation.window_style,
          recurring_props: projectLocation.recurring_props,
          distinctive_features: projectLocation.distinctive_features,
        };
      }
    }

    const style = getToonStyle();
    const prompt = buildPanelImagePrompt({
      sceneDescription: panel.scene ?? "",
      expression: panel.expression ?? "",
      imagePrompt: panel.image_prompt ?? "",
      characters: promptCharacters,
      style: style.prompt,
      aspectRatio: DEFAULT_PANEL_ASPECT_RATIO,
      coverNote: panel.panel_type === "cover" ? COVER_COMPOSITION_NOTE : undefined,
      location: locationContext,
      timeOfDay: panel.time_of_day,
    });

    const provider = getCharacterSheetProvider();

    const { data: genRow, error: genInsertErr } = await supabase
      .from("toon_generations")
      .insert({
        user_id: user.id,
        project_id: project.id,
        panel_id: panelId,
        generation_type: "panel_image",
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

    const storagePath = `${user.id}/${project.id}/raw/${panel.panel_number}/${generationId}.png`;
    const { error: uploadErr } = await supabase.storage
      .from(PANELS_BUCKET)
      .upload(storagePath, result.imageBytes, { contentType: "image/png", upsert: false });
    if (uploadErr) throw new Error("이미지 저장에 실패했습니다.");

    const { count: existingCount } = await supabase
      .from("toon_panel_images")
      .select("id", { count: "exact", head: true })
      .eq("panel_id", panelId);
    const generationVersion = (existingCount ?? 0) + 1;

    const { data: imageRow, error: imageInsertErr } = await supabase
      .from("toon_panel_images")
      .insert({
        panel_id: panelId,
        generation_id: generationId,
        provider: result.provider,
        model: result.model,
        status: "candidate",
        storage_path: storagePath,
        generation_version: generationVersion,
        prompt_snapshot: prompt,
      })
      .select()
      .single();
    if (imageInsertErr) throw new Error("이미지 기록 저장에 실패했습니다.");

    // STEP 7 §0.A — 새 candidate가 성공적으로 생기면, 같은 패널의 기존
    // 미승인(candidate) 이미지들은 더 이상 유효하지 않으므로 rejected로
    // 전환한다. approved는 이 쿼리의 필터 조건(status=candidate)에 걸리지
    // 않으므로 절대 건드리지 않는다.
    const { error: staleRejectErr } = await supabase
      .from("toon_panel_images")
      .update({ status: "rejected" })
      .eq("panel_id", panelId)
      .eq("status", "candidate")
      .neq("id", imageRow.id);
    if (staleRejectErr) {
      console.error("[panel-image] 기존 candidate 정리 실패:", staleRejectErr.message);
    }

    const { error: markSuccessErr } = await createAdminClient()
      .from("toon_generations")
      .update({ status: "success", model: result.model, image_count: 1 })
      .eq("id", generationId);
    if (markSuccessErr) {
      console.error("[panel-image] generation 상태 갱신 실패:", markSuccessErr.message);
    }

    logPanelGeneration({ panelId, provider: result.provider, status: "success", durationMs: Date.now() - startedAt });

    const { data: signed } = await supabase.storage.from(PANELS_BUCKET).createSignedUrl(storagePath, 3600);

    revalidatePath(`/toon/projects/${project.id}`);
    revalidatePath(`/toon/projects/${project.id}/images`);

    return {
      ok: true,
      image: {
        id: imageRow.id,
        status: imageRow.status,
        signedUrl: signed?.signedUrl ?? null,
        generationVersion: imageRow.generation_version,
      },
    };
  } catch (e) {
    if (generationId) {
      const { error: markFailedErr } = await createAdminClient()
        .from("toon_generations")
        .update({ status: "failed", error_message: e instanceof Error ? e.message.slice(0, 300) : "unknown" })
        .eq("id", generationId);
      if (markFailedErr) {
        console.error("[panel-image] generation 실패 상태 기록 실패:", markFailedErr.message);
      }
    }
    logPanelGeneration({
      panelId,
      provider: "unknown",
      status: "failed",
      durationMs: Date.now() - startedAt,
      errorType: e instanceof Error ? e.constructor.name : "Unknown",
    });
    return { ok: false, message: e instanceof Error ? e.message : "이미지 생성 중 오류가 발생했습니다." };
  } finally {
    inFlightPanelGeneration.delete(panelId);
  }
}

const MAX_EDIT_INSTRUCTION_LENGTH = 300;

/**
 * "부분 수정" — 기존 candidate/rejected 이미지 하나(sourcePanelImageId로
 * 정확히 지정)를 원본 reference로 그대로 Gemini에 다시 보내고, 텍스트
 * 수정 지시(editInstruction)만 반영한 새 이미지를 만든다.
 *
 * 안전 원칙(사용자 지시):
 * - panelId를 별도로 받지 않는다 — sourcePanelImageId 하나로 대상을
 *   특정하고, 그 이미지가 속한 panel/project를 서버가 직접 역산해서
 *   소유권을 검증한다("현재 candidate 아무거나"를 추측하지 않는다).
 * - toon_panel_images는 panel->project 2단계 RLS로 스코프되므로,
 *   남의 이미지거나 존재하지 않는 id면 이 시점에서 이미 null이 되어
 *   차단된다 — status(candidate/rejected)는 검사 조건에 넣지 않으므로
 *   과거 rejected 이미지도 그대로 원본으로 쓸 수 있다.
 * - 결과는 항상 새 toon_panel_images row(status='candidate')로만
 *   저장한다 — 원본 row/파일은 절대 수정·삭제하지 않는다.
 * - DB migration 없음 — 기존 generation_version/prompt_snapshot 구조를
 *   그대로 재사용한다. generation_type은 이미 001에 존재하지만 지금까지
 *   아무 코드도 쓰지 않던 'regenerate' 값을 재사용해 "처음 생성"과
 *   구분한다.
 */
export async function editPanelImageAction(
  sourcePanelImageId: string,
  editInstructionRaw: string
): Promise<GeneratePanelImageState> {
  const editInstruction = editInstructionRaw.trim();
  if (editInstruction.length === 0) {
    return { ok: false, message: "수정 요청을 입력해주세요." };
  }
  if (editInstruction.length > MAX_EDIT_INSTRUCTION_LENGTH) {
    return { ok: false, message: `수정 요청은 최대 ${MAX_EDIT_INSTRUCTION_LENGTH}자까지 입력할 수 있어요.` };
  }

  const lookupClient = await createClient();
  const {
    data: { user: lookupUser },
  } = await lookupClient.auth.getUser();
  if (!lookupUser) return { ok: false, message: "로그인이 필요합니다." };

  const { data: sourceImage, error: sourceErr } = await lookupClient
    .from("toon_panel_images")
    .select("id, panel_id, storage_path")
    .eq("id", sourcePanelImageId)
    .maybeSingle();
  if (sourceErr || !sourceImage) {
    return { ok: false, message: "수정할 원본 이미지를 찾을 수 없거나 접근 권한이 없습니다." };
  }

  const owned = await requireOwnedPanel(sourceImage.panel_id);
  if ("error" in owned) return { ok: false, message: owned.error };
  const { supabase, user, panel, project } = owned;

  if (inFlightPanelGeneration.has(panel.id)) {
    return { ok: false, message: "이미 이 컷의 이미지를 생성하고 있습니다. 잠시만 기다려주세요." };
  }
  inFlightPanelGeneration.add(panel.id);

  const startedAt = Date.now();
  let generationId: string | null = null;

  try {
    const { data: sourceFile, error: sourceDownloadErr } = await supabase.storage
      .from(PANELS_BUCKET)
      .download(sourceImage.storage_path);
    if (sourceDownloadErr || !sourceFile) throw new Error("수정할 원본 이미지를 불러오지 못했습니다.");
    const sourceImageBytes = { bytes: new Uint8Array(await sourceFile.arrayBuffer()), mimeType: sourceFile.type || "image/png" };

    const fullCharacters: ToonCharacter[] = [];
    for (const id of panel.character_ids) {
      const c = await getCharacter(supabase, id);
      if (!c) throw new Error("등장 캐릭터 정보를 불러올 수 없습니다.");
      fullCharacters.push(c);
    }

    // reference 배열 순서 = [원본(SOURCE), 캐릭터A, 캐릭터B, ...] —
    // buildPanelImageEditPrompt의 REFERENCE IMAGE ROLES 문구가 이 순서와
    // 정확히 1:1로 대응해야 하므로, 여기서 배열을 만드는 순서를 절대
    // 바꾸면 안 된다.
    const referenceImages = [sourceImageBytes];
    for (const c of fullCharacters) {
      const { data: sheet } = await supabase
        .from("toon_character_sheets")
        .select("storage_path")
        .eq("character_id", c.id)
        .eq("status", "approved")
        .maybeSingle();
      if (!sheet) throw new Error(`'${c.display_name}'의 승인된 Character Sheet를 찾을 수 없습니다.`);
      const { data: file, error: downloadErr } = await supabase.storage
        .from(REFERENCES_SHEET_BUCKET)
        .download(sheet.storage_path);
      if (downloadErr || !file) throw new Error("Character Sheet 이미지를 불러오지 못했습니다.");
      referenceImages.push({ bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type || "image/png" });
    }

    const prompt = buildPanelImageEditPrompt({
      editInstruction,
      characters: fullCharacters.map((c) => ({ display_name: c.display_name })),
    });

    const provider = getCharacterSheetProvider();

    const { data: genRow, error: genInsertErr } = await supabase
      .from("toon_generations")
      .insert({
        user_id: user.id,
        project_id: project.id,
        panel_id: panel.id,
        generation_type: "regenerate",
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

    const storagePath = `${user.id}/${project.id}/raw/${panel.panel_number}/${generationId}.png`;
    const { error: uploadErr } = await supabase.storage
      .from(PANELS_BUCKET)
      .upload(storagePath, result.imageBytes, { contentType: "image/png", upsert: false });
    if (uploadErr) throw new Error("이미지 저장에 실패했습니다.");

    const { count: existingCount } = await supabase
      .from("toon_panel_images")
      .select("id", { count: "exact", head: true })
      .eq("panel_id", panel.id);
    const generationVersion = (existingCount ?? 0) + 1;

    const { data: imageRow, error: imageInsertErr } = await supabase
      .from("toon_panel_images")
      .insert({
        panel_id: panel.id,
        generation_id: generationId,
        provider: result.provider,
        model: result.model,
        status: "candidate",
        storage_path: storagePath,
        generation_version: generationVersion,
        prompt_snapshot: prompt,
      })
      .select()
      .single();
    if (imageInsertErr) throw new Error("이미지 기록 저장에 실패했습니다.");

    // 새 candidate가 성공적으로 생기면 같은 panel의 기존 candidate는
    // rejected로 전환한다(기존 generatePanelImageAction과 동일한 정책) —
    // approved는 이 조건에 걸리지 않으므로 절대 건드리지 않고, 원본으로
    // 쓴 sourceImage가 이미 rejected/approved였다면 이 update는 그
    // row에 영향을 주지 않는다(오직 status='candidate'인 행만 대상).
    const { error: staleRejectErr } = await supabase
      .from("toon_panel_images")
      .update({ status: "rejected" })
      .eq("panel_id", panel.id)
      .eq("status", "candidate")
      .neq("id", imageRow.id);
    if (staleRejectErr) {
      console.error("[panel-image-edit] 기존 candidate 정리 실패:", staleRejectErr.message);
    }

    const { error: markSuccessErr } = await createAdminClient()
      .from("toon_generations")
      .update({ status: "success", model: result.model, image_count: 1 })
      .eq("id", generationId);
    if (markSuccessErr) {
      console.error("[panel-image-edit] generation 상태 갱신 실패:", markSuccessErr.message);
    }

    logPanelGeneration({ panelId: panel.id, provider: result.provider, status: "success", durationMs: Date.now() - startedAt });

    const { data: signed } = await supabase.storage.from(PANELS_BUCKET).createSignedUrl(storagePath, 3600);

    revalidatePath(`/toon/projects/${project.id}`);
    revalidatePath(`/toon/projects/${project.id}/images`);

    return {
      ok: true,
      image: {
        id: imageRow.id,
        status: imageRow.status,
        signedUrl: signed?.signedUrl ?? null,
        generationVersion: imageRow.generation_version,
      },
    };
  } catch (e) {
    if (generationId) {
      const { error: markFailedErr } = await createAdminClient()
        .from("toon_generations")
        .update({ status: "failed", error_message: e instanceof Error ? e.message.slice(0, 300) : "unknown" })
        .eq("id", generationId);
      if (markFailedErr) {
        console.error("[panel-image-edit] generation 실패 상태 기록 실패:", markFailedErr.message);
      }
    }
    logPanelGeneration({
      panelId: panel.id,
      provider: "unknown",
      status: "failed",
      durationMs: Date.now() - startedAt,
      errorType: e instanceof Error ? e.constructor.name : "Unknown",
    });
    // provider 원문 오류/storage 경로 등 내부 정보를 그대로 노출하지
    // 않고, 이미 한국어로 다듬어진 Error.message만 그대로 전달한다
    // (이 함수 안의 모든 throw가 이미 사용자용 문구다).
    return { ok: false, message: e instanceof Error ? e.message : "이미지 수정 중 오류가 발생했습니다." };
  } finally {
    inFlightPanelGeneration.delete(panel.id);
  }
}

export async function approvePanelImageAction(
  panelId: string,
  panelImageId: string
): Promise<{ ok: boolean; message?: string }> {
  const owned = await requireOwnedPanel(panelId);
  if ("error" in owned) return { ok: false, message: owned.error };
  const { supabase } = owned;

  const { data: targetImage, error: fetchErr } = await supabase
    .from("toon_panel_images")
    .select("id, storage_path, panel_id")
    .eq("id", panelImageId)
    .eq("panel_id", panelId)
    .maybeSingle();
  if (fetchErr || !targetImage) {
    return { ok: false, message: "승인할 이미지를 찾을 수 없습니다." };
  }

  const { error: demoteErr } = await supabase
    .from("toon_panel_images")
    .update({ status: "rejected" })
    .eq("panel_id", panelId)
    .eq("status", "approved");
  if (demoteErr) return { ok: false, message: "기존 이미지 상태 변경에 실패했습니다." };

  const { error: approveErr } = await supabase
    .from("toon_panel_images")
    .update({ status: "approved" })
    .eq("id", panelImageId);
  if (approveErr) return { ok: false, message: "승인 처리에 실패했습니다." };

  const { error: panelUpdateErr } = await supabase
    .from("toon_panels")
    .update({ raw_image_url: targetImage.storage_path })
    .eq("id", panelId);
  if (panelUpdateErr) return { ok: false, message: "컷 정보 갱신에 실패했습니다." };

  revalidatePath(`/toon/projects/${owned.project.id}`);
  revalidatePath(`/toon/projects/${owned.project.id}/images`);
  return { ok: true };
}

export interface UpdatePanelLocationInput {
  location_id: string | null;
  time_of_day: ToonTimeOfDay | null;
}

const VALID_TIME_OF_DAY_VALUES: ToonTimeOfDay[] = ["MORNING", "DAY", "EVENING", "NIGHT", "LATE_NIGHT"];

/**
 * 021 — 이미 확정(confirmed)된 프로젝트를 포함해, 기존 panel의
 * Location/Time of Day를 Storyboard 전체 재생성 없이 직접 지정/수정한다.
 * AI를 호출하지 않고, Storyboard/character_ids/이미지 등 다른 어떤
 * 것도 건드리지 않는다 — 오직 toon_panels.location_id/time_of_day만
 * 갱신한다. 그 뒤 이 panel의 이미지를 새로 생성하면(기존 candidate는
 * rejected로 이동, 삭제되지 않음) 바뀐 Location Bible/시간대가 반영된다.
 */
export async function updatePanelLocationAction(
  panelId: string,
  input: UpdatePanelLocationInput
): Promise<{ ok: boolean; message?: string }> {
  const owned = await requireOwnedPanel(panelId);
  if ("error" in owned) return { ok: false, message: owned.error };
  const { supabase, panel } = owned;

  if (input.time_of_day && !VALID_TIME_OF_DAY_VALUES.includes(input.time_of_day)) {
    return { ok: false, message: "시간대 값이 올바르지 않습니다." };
  }

  if (input.location_id) {
    // getLocation은 RLS로 스코프되므로 남의 location_id면 null이 되어
    // 별도 소유권 비교 없이 타인 장소 지정 시도가 차단된다.
    const location = await getLocation(supabase, input.location_id);
    if (!location) return { ok: false, message: "장소를 찾을 수 없거나 접근 권한이 없습니다." };
  }

  // 022 — 이 액션은 항상 Saved Location(또는 "장소 없음")만 수동으로
  // 지정한다. Temporary Location은 사용자가 직접 관리하지 않으므로,
  // 여기서 Saved 쪽을 바꾸면 그 컷의 project_location_id는 항상
  // null로 정리한다(DB CHECK toon_panels_location_exclusive와도 일치).
  const { error } = await supabase
    .from("toon_panels")
    .update({ location_id: input.location_id, time_of_day: input.time_of_day, project_location_id: null })
    .eq("id", panelId);
  if (error) return { ok: false, message: "장소/시간대 저장에 실패했습니다." };

  revalidatePath(`/toon/projects/${panel.project_id}`);
  revalidatePath(`/toon/projects/${panel.project_id}/images`);
  return { ok: true };
}

export interface PanelImagesSummary {
  approvedByPanel: Record<string, PanelImageView>;
  candidateByPanel: Record<string, PanelImageView>;
  allApproved: boolean;
}

export async function getPanelImagesSummary(
  supabase: Awaited<ReturnType<typeof createClient>>,
  panels: ToonPanel[]
): Promise<PanelImagesSummary> {
  const approvedByPanel: Record<string, PanelImageView> = {};
  const candidateByPanel: Record<string, PanelImageView> = {};

  for (const panel of panels) {
    const { data } = await supabase
      .from("toon_panel_images")
      .select("*")
      .eq("panel_id", panel.id)
      .order("created_at", { ascending: false });

    const approvedRow = (data ?? []).find((r: { status: string }) => r.status === "approved");
    const candidateRow = (data ?? []).find((r: { status: string }) => r.status === "candidate");

    if (approvedRow) {
      const { data: signed } = await supabase.storage
        .from(PANELS_BUCKET)
        .createSignedUrl(approvedRow.storage_path, 3600);
      approvedByPanel[panel.id] = {
        id: approvedRow.id,
        status: "approved",
        signedUrl: signed?.signedUrl ?? null,
        generationVersion: approvedRow.generation_version,
      };
    }
    if (candidateRow) {
      const { data: signed } = await supabase.storage
        .from(PANELS_BUCKET)
        .createSignedUrl(candidateRow.storage_path, 3600);
      candidateByPanel[panel.id] = {
        id: candidateRow.id,
        status: "candidate",
        signedUrl: signed?.signedUrl ?? null,
        generationVersion: candidateRow.generation_version,
      };
    }
  }

  const allApproved = panels.length > 0 && panels.every((p) => approvedByPanel[p.id]);

  return { approvedByPanel, candidateByPanel, allApproved };
}
