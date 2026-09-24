"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { getProject, getProjectPanels } from "./service";
import {
  EXTERNAL_IMAGE_COUNT, EXTERNAL_IMAGE_MAX_BYTES, externalImageMime,
  isExternalStoragePath, missingExternalPanelRows, validateExternalImageFiles, type ExternalImageFile,
} from "./externalImageUtils";

const BUCKET = "toon-panels";
const inFlight = new Set<string>();
type Client = Awaited<ReturnType<typeof createClient>>;
type Upload = { path: string; token: string };
type State = { ok: boolean; message?: string; uploads?: Upload[]; conflicts?: number[] };

async function owned(projectId: string, allowCompleted = false) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." as const };
  const project = await getProject(supabase, projectId);
  if (!project) return { error: "프로젝트에 접근할 수 없습니다." as const };
  if (project.panel_count !== EXTERNAL_IMAGE_COUNT) return { error: "외부 이미지 가져오기는 11장 프로젝트에서 사용할 수 있습니다." as const };
  if (project.status === "completed" && !allowCompleted) return { error: "완성된 프로젝트는 먼저 다시 편집하기를 선택해주세요." as const };
  return { supabase, user, project };
}

async function findConflicts(supabase: Client, projectId: string) {
  const panels = await getProjectPanels(supabase, projectId);
  const conflicts = panels.filter((p) => p.raw_image_url || p.image_url).map((p) => p.panel_number);
  const { data, error } = await supabase.from("toon_panel_images")
    .select("panel_id").in("panel_id", panels.map((p) => p.id)).eq("status", "approved");
  if (error) throw new Error("기존 승인 이미지 확인에 실패했습니다.");
  for (const row of data ?? []) {
    const number = panels.find((p) => p.id === row.panel_id)?.panel_number;
    if (number && !conflicts.includes(number)) conflicts.push(number);
  }
  if (panels.some((p) => (p.panel_number === 1 ? p.panel_type !== "cover" : p.panel_type !== "scene"))) {
    throw new Error("기존 컷 구조가 표지 + 본문 10장과 다릅니다. 기존 스토리보드는 변경하지 않았습니다.");
  }
  return { panels, conflicts: conflicts.sort((a, b) => a - b) };
}

/** No DB or object writes: issues one-use signed upload URLs only after the user confirms the preview. */
export async function prepareExternalUploadAction(projectId: string, files: ExternalImageFile[]): Promise<State> {
  const error = validateExternalImageFiles(files);
  if (error) return { ok: false, message: error };
  const access = await owned(projectId);
  if ("error" in access) return { ok: false, message: access.error };
  try {
    const { conflicts } = await findConflicts(access.supabase, projectId);
    if (conflicts.length) return { ok: false, conflicts, message: `이미 사용 중인 이미지가 있는 컷: ${conflicts.join(", ")}. 자동 교체하지 않습니다.` };
    const batch = crypto.randomUUID();
    const uploads: Upload[] = [];
    for (const [index, file] of files.entries()) {
      const ext = file.name.split(".").pop()!.toLowerCase();
      const path = `${access.user.id}/${projectId}/external/${index + 1}/${batch}_${crypto.randomUUID()}.${ext}`;
      const { data, error: signedError } = await access.supabase.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false });
      if (signedError || !data) return { ok: false, message: "업로드 준비에 실패했습니다. 다시 시도해주세요." };
      uploads.push({ path, token: data.token });
    }
    return { ok: true, uploads };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "업로드 준비에 실패했습니다." };
  }
}

function validBatch(paths: string[], userId: string, projectId: string): boolean {
  if (paths.length !== EXTERNAL_IMAGE_COUNT || new Set(paths).size !== EXTERNAL_IMAGE_COUNT) return false;
  const batch = paths[0]?.split("/").pop()?.split("_")[0];
  return Boolean(batch && paths.every((p, i) => isExternalStoragePath(p, userId, projectId, i + 1)
    && p.split("/").pop()?.startsWith(`${batch}_`)));
}

async function cleanup(supabase: Client, paths: string[]) {
  if (!paths.length) return true;
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) console.error("[external-import] storage cleanup failed", { count: paths.length });
  return !error;
}

/** Cleans only uncommitted paths from this batch; never touches existing approved/final originals. */
export async function cancelExternalUploadAction(projectId: string, paths: string[]): Promise<State> {
  const access = await owned(projectId, true);
  if ("error" in access) return { ok: false, message: access.error };
  if (!validBatch(paths, access.user.id, projectId)) return { ok: false, message: "업로드 정보가 올바르지 않습니다." };
  const { panels } = await findConflicts(access.supabase, projectId);
  if (panels.some((p) => paths.includes(p.raw_image_url ?? ""))) return { ok: false, message: "사용 중인 원본은 삭제할 수 없습니다." };
  const { data: recorded, error: lookupError } = await access.supabase.from("toon_panel_images").select("storage_path").in("storage_path", paths);
  if (lookupError || recorded?.length) return { ok: false, message: "이미지 기록이 남아 있어 파일을 삭제할 수 없습니다." };
  return (await cleanup(access.supabase, paths)) ? { ok: true } : { ok: false, message: "업로드 파일 정리에 실패했습니다." };
}

export async function finishExternalUploadAction(projectId: string, paths: string[]): Promise<State> {
  const access = await owned(projectId);
  if ("error" in access) return { ok: false, message: access.error };
  const { supabase, user, project } = access;
  if (!validBatch(paths, user.id, projectId)) return { ok: false, message: "업로드 정보가 올바르지 않습니다." };
  if (inFlight.has(projectId)) return { ok: false, message: "이미 가져오기 작업이 진행 중입니다." };
  inFlight.add(projectId);
  const newPanelIds: string[] = [];
  const newImageIds: string[] = [];
  const linked: { id: string; path: string }[] = [];
  let statusChanged = false;
  let committed = false;
  try {
    const original = await findConflicts(supabase, projectId);
    if (original.conflicts.length) throw new Error(`이미 승인된 이미지가 있는 컷: ${original.conflicts.join(", ")}. 기존 이미지를 변경하지 않았습니다.`);
    for (const path of paths) {
      const { data, error } = await supabase.storage.from(BUCKET).info(path);
      const mime = externalImageMime({ name: path, type: data?.contentType ?? "", size: data?.size ?? 0 });
      if (error || !data || !mime || !data.size || data.size > EXTERNAL_IMAGE_MAX_BYTES) {
        throw new Error("업로드한 파일 형식이나 크기를 확인할 수 없습니다.");
      }
    }
    const existing = new Set(original.panels.map((p) => p.panel_number));
    const rows = missingExternalPanelRows(projectId, Array.from({ length: EXTERNAL_IMAGE_COUNT }, (_, i) => i + 1).filter((n) => !existing.has(n)));
    if (rows.length) {
      const { data, error } = await supabase.from("toon_panels").insert(rows).select("id");
      if (error || !data || data.length !== rows.length) throw new Error("빈 컷 준비에 실패했습니다.");
      newPanelIds.push(...data.map((p) => p.id));
    }
    const panels = await getProjectPanels(supabase, projectId);
    if (panels.length !== EXTERNAL_IMAGE_COUNT || panels.some((p, i) => p.panel_number !== i + 1)) throw new Error("컷 순서를 확인할 수 없습니다.");
    for (const [index, panel] of panels.entries()) {
      // A conditional write and the approved unique index also defend against concurrent imports.
      const { data: changed, error: linkError } = await supabase.from("toon_panels")
        .update({ raw_image_url: paths[index] }).eq("id", panel.id).is("raw_image_url", null).select("id");
      if (linkError || !changed?.length) throw new Error("다른 요청에서 이미지를 먼저 연결했습니다. 기존 이미지는 보존했습니다.");
      linked.push({ id: panel.id, path: paths[index] });
      const { data: row, error: imageError } = await supabase.from("toon_panel_images").insert({
        panel_id: panel.id, generation_id: null, provider: "external", model: "upload", status: "approved",
        storage_path: paths[index], generation_version: panel.generation_version ?? 1, prompt_snapshot: "external upload",
      }).select("id").single();
      if (imageError || !row) throw new Error("외부 이미지 기록 저장에 실패했습니다.");
      newImageIds.push(row.id);
    }
    if (project.status !== "confirmed") {
      const { error } = await supabase.from("toon_projects").update({ status: "confirmed" }).eq("id", projectId);
      if (error) throw new Error("편집 단계로 이동하지 못했습니다.");
      statusChanged = true;
    }
    committed = true;
    revalidatePath(`/toon/projects/${projectId}`);
    revalidatePath(`/toon/projects/${projectId}/images`);
    revalidatePath(`/toon/projects/${projectId}/editor`);
    return { ok: true };
  } catch (e) {
    // Compensating rollback: reverse only rows/pointers created by this request.
    let rollbackFailed = false;
    if (newImageIds.length) {
      const { error } = await supabase.from("toon_panel_images").delete().in("id", newImageIds);
      if (error) { rollbackFailed = true; console.error("[external-import] image row rollback failed", { count: newImageIds.length }); }
    }
    for (const entry of linked.reverse()) {
      const { error } = await supabase.from("toon_panels").update({ raw_image_url: null }).eq("id", entry.id).eq("raw_image_url", entry.path);
      if (error) { rollbackFailed = true; console.error("[external-import] panel rollback failed", { panelId: entry.id }); }
    }
    if (newPanelIds.length) {
      const { error } = await supabase.from("toon_panels").delete().in("id", newPanelIds);
      if (error) { rollbackFailed = true; console.error("[external-import] empty panel rollback failed", { count: newPanelIds.length }); }
    }
    if (statusChanged) {
      const { error } = await supabase.from("toon_projects").update({ status: project.status }).eq("id", projectId);
      if (error) { rollbackFailed = true; console.error("[external-import] status rollback failed", { projectId }); }
    }
    if (rollbackFailed) return { ok: false, message: "이미지 저장 후 되돌리기에 실패했습니다. 기존 원본을 보호하기 위해 파일을 유지했습니다. 관리자에게 문의해주세요." };
    const cleaned = await cleanup(supabase, paths);
    return { ok: false, message: cleaned ? (e instanceof Error ? e.message : "이미지 가져오기에 실패했습니다.") : "이미지 가져오기에 실패했고 업로드 파일 정리에 실패했습니다. 관리자에게 문의해주세요." };
  } finally {
    inFlight.delete(projectId);
    if (committed) console.info("[external-import] completed", { projectId, count: paths.length });
  }
}
