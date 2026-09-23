"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { getProject, getProjectPanels } from "./service";
import { checkCompletionReadiness } from "./finalUtils";
import { getCaptionView, type CaptionView } from "./captions";

const PANELS_BUCKET = "toon-panels";

type RequireOwnedProjectResult =
  | { error: string }
  | { supabase: Awaited<ReturnType<typeof createClient>>; project: NonNullable<Awaited<ReturnType<typeof getProject>>> };

async function requireOwnedProject(projectId: string): Promise<RequireOwnedProjectResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const project = await getProject(supabase, projectId);
  if (!project) return { error: "프로젝트를 찾을 수 없거나 접근 권한이 없습니다." };

  return { supabase, project };
}

export interface FinalPanelView {
  panelNumber: number;
  finalSignedUrl: string | null;
  storagePath: string | null;
}

export interface FinalPageData {
  ok: true;
  project: { id: string; title: string; status: string };
  panels: FinalPanelView[];
  readiness: { ready: boolean; errors: string[] };
  caption: CaptionView | null;
}

export interface FinalPageError {
  ok: false;
  message: string;
}

export async function getFinalPageData(projectId: string): Promise<FinalPageData | FinalPageError> {
  const owned = await requireOwnedProject(projectId);
  if ("error" in owned) return { ok: false, message: owned.error };
  const { supabase, project } = owned;

  if (project.status === "draft" || project.status === "storyboard") {
    return { ok: false, message: "아직 스토리보드가 확정되지 않았습니다." };
  }

  const panels = await getProjectPanels(supabase, project.id);
  const readiness = checkCompletionReadiness(project, panels);

  const panelViews: FinalPanelView[] = [];
  for (const panel of panels) {
    let signedUrl: string | null = null;
    if (panel.image_url) {
      const { data: signed } = await supabase.storage.from(PANELS_BUCKET).createSignedUrl(panel.image_url, 3600);
      signedUrl = signed?.signedUrl ?? null;
    }
    panelViews.push({ panelNumber: panel.panel_number, finalSignedUrl: signedUrl, storagePath: panel.image_url });
  }

  const caption = await getCaptionView(project.id);

  return {
    ok: true,
    project: { id: project.id, title: project.title, status: project.status },
    panels: panelViews,
    readiness,
    caption,
  };
}

export interface CompleteProjectState {
  ok: boolean;
  message?: string;
}

/**
 * STEP 8 §1, §14 — 서버 측에서 다시 한번 완료 조건을 검증한 뒤에만
 * status를 completed로 바꾼다. 이미 completed인 경우는 아무 것도
 * 바꾸지 않고 성공으로 처리한다(안전한 재시도/멱등).
 */
export async function completeProjectAction(projectId: string): Promise<CompleteProjectState> {
  const owned = await requireOwnedProject(projectId);
  if ("error" in owned) return { ok: false, message: owned.error };
  const { supabase, project } = owned;

  if (project.status === "completed") return { ok: true };

  const panels = await getProjectPanels(supabase, project.id);
  const readiness = checkCompletionReadiness(project, panels);
  if (!readiness.ready) {
    return { ok: false, message: readiness.errors.join(" / ") };
  }

  const { error } = await supabase.from("toon_projects").update({ status: "completed" }).eq("id", project.id);
  if (error) return { ok: false, message: "완료 처리에 실패했습니다." };

  revalidatePath(`/toon/projects/${project.id}/final`);
  revalidatePath("/toon/projects");
  return { ok: true };
}

/**
 * STEP 8 §14 — "다시 편집하기": completed 프로젝트를 실수로 바꾸지
 * 않도록, 편집을 재개하려면 이 명시적 액션을 먼저 거쳐 status를
 * confirmed로 되돌려야만 STEP7 에디터에 다시 들어갈 수 있다.
 */
export async function reopenProjectAction(projectId: string): Promise<CompleteProjectState> {
  const owned = await requireOwnedProject(projectId);
  if ("error" in owned) return { ok: false, message: owned.error };
  const { supabase, project } = owned;

  if (project.status !== "completed") return { ok: true };

  const { error } = await supabase.from("toon_projects").update({ status: "confirmed" }).eq("id", project.id);
  if (error) return { ok: false, message: "다시 편집하기로 전환하지 못했습니다." };

  revalidatePath(`/toon/projects/${project.id}/final`);
  revalidatePath(`/toon/projects/${project.id}/editor`);
  return { ok: true };
}
