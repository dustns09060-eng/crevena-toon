"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { getProject, getProjectCharacters, getProjectPanels } from "./service";
import { buildImportUpdates, importConflicts, originalImportValues, parseDialogueImport, validateImportSpeakers, type DialogueImportDocument, type ImportConflict } from "./dialogueImportUtils";
import type { ToonPanel } from "../../src/db/types";

type Inspection = { ok: true; document: DialogueImportDocument; conflicts: ImportConflict[]; fingerprint: string }
  | { ok: false; message: string };
type SaveResult = { ok: boolean; message: string; count?: number };
const inFlight = new Set<string>();

function fingerprint(doc: DialogueImportDocument, panels: ToonPanel[]) {
  const affected = [1, ...doc.panels.map((p) => p.panel_number + 1)];
  return createHash("sha256").update(JSON.stringify(panels.filter((p) => affected.includes(p.panel_number)).map((p) => [p.id, p.updated_at, originalImportValues(p)]))).digest("hex");
}

async function readImport(projectId: string, json: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." } as const;
  const project = await getProject(supabase, projectId);
  if (!project || project.user_id !== user.id) return { error: "프로젝트에 접근할 수 없습니다." } as const;
  if (project.status === "completed") return { error: "완성된 프로젝트는 먼저 다시 편집하기를 선택해주세요." } as const;
  const parsed = parseDialogueImport(json, project.panel_count);
  if (!parsed.ok) return { error: parsed.message } as const;
  const panels = await getProjectPanels(supabase, projectId);
  if (panels.length !== project.panel_count || panels.some((p, i) => p.panel_number !== i + 1 || p.panel_type !== (i === 0 ? "cover" : "scene"))) {
    return { error: "표지를 포함한 프로젝트 컷 구성이 올바르지 않습니다." } as const;
  }
  // Approved external images on every panel are required; non-external projects never expose this action.
  const { data: external, error } = await supabase.from("toon_panel_images")
    .select("panel_id, storage_path").in("panel_id", panels.map((p) => p.id)).eq("provider", "external").eq("model", "upload").eq("status", "approved");
  if (error) return { error: "외부 이미지 상태를 확인하지 못했습니다." } as const;
  if (panels.some((p) => !p.raw_image_url || !external?.some((row) => row.panel_id === p.id && row.storage_path === p.raw_image_url))) {
    return { error: "모든 컷에 승인된 외부 이미지가 있어야 합니다." } as const;
  }
  const characters = await getProjectCharacters(supabase, projectId);
  const speakerError = validateImportSpeakers(parsed.value, characters);
  if (speakerError) return { error: speakerError } as const;
  return { supabase, panels, characters, doc: parsed.value };
}

/** Read-only preview. Missing panel numbers are explicitly left unchanged. */
export async function inspectDialogueImportAction(projectId: string, json: string): Promise<Inspection> {
  try {
    const current = await readImport(projectId, json);
    if ("error" in current) return { ok: false, message: current.error ?? "가져오기를 검사하지 못했습니다." };
    return { ok: true, document: current.doc, conflicts: importConflicts(current.doc, current.panels), fingerprint: fingerprint(current.doc, current.panels) };
  } catch { return { ok: false, message: "가져올 내용을 검사하지 못했습니다." }; }
}

/** Writes only imported text and its required layouts. Compensates successful writes on failure. */
export async function saveDialogueImportAction(projectId: string, json: string, expectedFingerprint: string, replaceExisting: boolean): Promise<SaveResult> {
  if (inFlight.has(projectId)) return { ok: false, message: "이미 가져오기가 진행 중입니다." };
  inFlight.add(projectId);
  try {
    const current = await readImport(projectId, json);
    if ("error" in current) return { ok: false, message: current.error ?? "가져오기를 검사하지 못했습니다." };
    const { supabase, panels, characters, doc } = current;
    if (fingerprint(doc, panels) !== expectedFingerprint) return { ok: false, message: "검사 이후 기존 내용이 바뀌었습니다. 다시 검사해주세요." };
    if (importConflicts(doc, panels).some((c) => c.dialogue || c.narration || c.coverTitle || c.coverSubtitle) && !replaceExisting) {
      return { ok: false, message: "기존 대사/내레이션/표지 내용을 교체하려면 확인이 필요합니다." };
    }
    const updates = buildImportUpdates(doc, panels, characters);
    const saved: { panel: ToonPanel; updatedAt: string }[] = [];
    try {
      for (const { panel, values } of updates) {
        // updated_at guards against changes since preview and concurrent edits.
        const { data, error } = await supabase.from("toon_panels").update(values)
          .eq("id", panel.id).eq("project_id", projectId).eq("updated_at", panel.updated_at)
          .select("id, updated_at");
        if (error || data?.length !== 1) throw Error("저장 중 다른 편집이 발생했거나 일부 컷 저장에 실패했습니다.");
        saved.push({ panel, updatedAt: data[0].updated_at });
      }
    } catch {
      let failedRollback = false;
      for (const { panel, updatedAt } of saved.reverse()) {
        try {
          const { data, error } = await supabase.from("toon_panels").update(originalImportValues(panel))
            .eq("id", panel.id).eq("project_id", projectId).eq("updated_at", updatedAt).select("id");
          if (error || data?.length !== 1) failedRollback = true;
        } catch { failedRollback = true; }
      }
      if (failedRollback) {
        console.error("[dialogue-import] compensation incomplete", { projectId, count: saved.length });
        return { ok: false, message: "일부 내용의 되돌리기에 실패했습니다. 편집기에서 상태를 확인해주세요." };
      }
      return { ok: false, message: "저장에 실패하여 이번 가져오기에서 변경한 내용을 되돌렸습니다." };
    }
    revalidatePath(`/toon/projects/${projectId}/editor`);
    return { ok: true, message: `Cover + ${doc.panels.length}개 Panel의 대사/내레이션을 가져왔습니다.`, count: doc.panels.length };
  } catch {
    return { ok: false, message: "가져오기를 완료하지 못했습니다." };
  } finally { inFlight.delete(projectId); }
}
