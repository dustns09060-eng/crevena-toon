"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { getProject, getProjectPanels } from "./service";
import { smartLayoutPanel, type SmartPanel } from "../editor/smartLayout";
import { validateCoverTitleBubble, validateNarrationBubble, validateToonDialogue } from "../../src/db/validation";
import type { ToonPanel } from "../../src/db/types";
import { canAutomaticallyArrange, panelLayoutSource } from "../editor/layoutProvenance";

type Target = { id: string; updatedAt: string };
type Result = { ok: boolean; message: string; count?: number };
const inFlight = new Set<string>();

function storedSmartPanel(panel: ToonPanel): SmartPanel {
  return {
    id: panel.id, panelType: panel.panel_type, dialogue: panel.dialogue,
    narration: panel.narration, narrationBubble: panel.narration_bubble,
    coverTitle: panel.cover_title, coverSubtitle: panel.cover_subtitle,
    coverTitleBubble: panel.cover_title_bubble,
    hasStoredLayout: !canAutomaticallyArrange(panelLayoutSource({ panelType: panel.panel_type, coverTitleBubble: panel.cover_title_bubble, dialogue: panel.dialogue, narrationBubble: panel.narration_bubble })),
  };
}

function original(panel: ToonPanel) {
  return panel.panel_type === "cover" ? { cover_title_bubble: panel.cover_title_bubble }
    : { dialogue: panel.dialogue, narration_bubble: panel.narration_bubble };
}

/** The server recalculates everything from current DB text; the browser cannot submit new text or image URLs. */
export async function applySmartLayoutAction(projectId: string, targets: Target[], overwrite: boolean): Promise<Result> {
  if (inFlight.has(projectId)) return { ok: false, message: "이미 자동 배치를 적용 중입니다." };
  inFlight.add(projectId);
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, message: "로그인이 필요합니다." };
    const project = await getProject(supabase, projectId);
    if (!project || project.user_id !== user.id || project.status === "completed") return { ok: false, message: "프로젝트를 편집할 수 없습니다." };
    const panels = await getProjectPanels(supabase, projectId);
    const requested = new Map(targets.map((t) => [t.id, t.updatedAt]));
    if (!targets.length || requested.size !== targets.length || panels.length !== project.panel_count || targets.some((t) => !panels.some((p) => p.id === t.id && p.updated_at === t.updatedAt))) {
      return { ok: false, message: "컷 구성이 바뀌었습니다. 다시 미리보기를 확인해주세요." };
    }
    const updates = panels.filter((p) => requested.has(p.id)).map((panel) => ({ panel, result: smartLayoutPanel(storedSmartPanel(panel), overwrite) }));
    if (updates.some(({ result }) => result.status === "REVIEW_REQUIRED")) return { ok: false, message: "검토가 필요한 컷은 자동 저장할 수 없습니다." };
    const ready = updates.filter(({ result }) => result.status === "PASS");
    for (const { panel, result } of ready) {
      const valid = panel.panel_type === "cover" ? validateCoverTitleBubble(result.panel.coverTitleBubble).valid
        : validateToonDialogue(result.panel.dialogue).valid && validateNarrationBubble(result.panel.narrationBubble).valid;
      if (!valid) return { ok: false, message: "자동 배치가 검증을 통과하지 못했습니다." };
    }
    const saved: { panel: ToonPanel; updatedAt: string }[] = [];
    try {
      for (const { panel, result } of ready) {
        const values = panel.panel_type === "cover" ? { cover_title_bubble: result.panel.coverTitleBubble }
          : { dialogue: result.panel.dialogue, narration_bubble: result.panel.narrationBubble };
        const { data, error } = await supabase.from("toon_panels").update(values)
          .eq("id", panel.id).eq("project_id", projectId).eq("updated_at", panel.updated_at).select("id,updated_at");
        if (error || data?.length !== 1) throw Error("write failed");
        saved.push({ panel, updatedAt: data[0].updated_at });
      }
    } catch {
      let rollbackFailed = false;
      for (const { panel, updatedAt } of saved.reverse()) {
        try {
          const { data, error } = await supabase.from("toon_panels").update(original(panel))
            .eq("id", panel.id).eq("project_id", projectId).eq("updated_at", updatedAt).select("id");
          if (error || data?.length !== 1) rollbackFailed = true;
        } catch { rollbackFailed = true; }
      }
      if (rollbackFailed) {
        console.error("[smart-layout] layout rollback incomplete", { projectId, count: saved.length });
        return { ok: false, message: "일부 배치를 되돌리지 못했습니다. 편집기에서 상태를 확인해주세요." };
      }
      return { ok: false, message: "저장에 실패하여 이번 자동 배치 변경을 되돌렸습니다." };
    }
    revalidatePath(`/toon/projects/${projectId}/editor`);
    return { ok: true, message: `${ready.length}개 컷의 자동 배치를 저장했습니다.`, count: ready.length };
  } catch {
    return { ok: false, message: "자동 배치를 저장하지 못했습니다." };
  } finally { inFlight.delete(projectId); }
}
