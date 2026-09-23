"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { getProject, getProjectPanels } from "./service";
import { getCaptionProvider } from "../../src/providers/captionProviderRegistry";
import { CaptionResultSchema } from "../../src/providers/captionSchema";
import type { CaptionPanelContext } from "../../src/providers/CaptionProvider";

/**
 * STEP 8 — 이 파일은 이미지 생성/캐릭터 분석/스토리보드 Provider를 전혀
 * import하지 않는다. 캡션 생성은 순수 텍스트(제목/요약/대사/내레이션)만
 * 다루며, 원본 사진·Character Sheet·완성 이미지를 절대 전달하지 않는다.
 */

async function requireOwnedProject(projectId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." as const };

  const project = await getProject(supabase, projectId);
  if (!project) return { error: "프로젝트를 찾을 수 없거나 접근 권한이 없습니다." as const };

  return { supabase, project };
}

export interface CaptionView {
  caption: string;
  hashtags: string[];
  updatedAt: string;
}

export async function getCaptionView(projectId: string): Promise<CaptionView | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("toon_captions")
    .select("caption, hashtags, updated_at")
    .eq("project_id", projectId)
    .maybeSingle();
  if (!data || !data.caption) return null;
  return { caption: data.caption, hashtags: data.hashtags ?? [], updatedAt: data.updated_at };
}

export interface GenerateCaptionState {
  ok: boolean;
  message?: string;
  caption?: string;
  hashtags?: string[];
}

/**
 * AI를 호출해 caption/hashtags "후보"를 만들어 그대로 클라이언트에
 * 돌려줄 뿐, DB에는 절대 쓰지 않는다 — 사용자가 [캡션 저장]을 눌러야만
 * saveCaptionAction()을 통해 영속화된다(STEP3/5의 candidate 원칙과 동일한
 * "AI 결과 ≠ 즉시 확정" 안전장치).
 */
export async function generateCaptionAction(projectId: string): Promise<GenerateCaptionState> {
  const owned = await requireOwnedProject(projectId);
  if ("error" in owned) return { ok: false, message: owned.error };
  const { supabase, project } = owned;

  const panels = await getProjectPanels(supabase, project.id);
  if (panels.length === 0) return { ok: false, message: "스토리보드가 없습니다." };

  const panelContexts: CaptionPanelContext[] = panels.map((p) => ({
    panel_number: p.panel_number,
    scene: p.scene,
    dialogue_texts: p.dialogue.map((d) => d.text),
    narration: p.narration,
  }));

  try {
    const provider = getCaptionProvider();
    const result = await provider.generateCaption({
      title: project.title,
      storySummary: project.story_summary,
      panels: panelContexts,
    });

    const validated = CaptionResultSchema.safeParse(result);
    if (!validated.success) {
      return { ok: false, message: "AI 캡션 결과가 유효하지 않습니다. 다시 시도해주세요." };
    }

    return { ok: true, caption: validated.data.caption, hashtags: validated.data.hashtags };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "캡션 생성 중 오류가 발생했습니다." };
  }
}

export interface SaveCaptionState {
  ok: boolean;
  message?: string;
}

export async function saveCaptionAction(
  projectId: string,
  caption: string,
  hashtags: string[]
): Promise<SaveCaptionState> {
  const owned = await requireOwnedProject(projectId);
  if ("error" in owned) return { ok: false, message: owned.error };
  const { supabase, project } = owned;

  const validated = CaptionResultSchema.safeParse({ caption, hashtags });
  if (!validated.success) {
    return { ok: false, message: "캡션/해시태그 형식이 올바르지 않습니다: " + validated.error.issues.map((i) => i.message).join(", ") };
  }

  const { data: existing } = await supabase
    .from("toon_captions")
    .select("id")
    .eq("project_id", project.id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("toon_captions")
      .update({ caption: validated.data.caption, hashtags: validated.data.hashtags })
      .eq("id", existing.id);
    if (error) return { ok: false, message: "캡션 저장에 실패했습니다." };
  } else {
    const { error } = await supabase
      .from("toon_captions")
      .insert({ project_id: project.id, caption: validated.data.caption, hashtags: validated.data.hashtags });
    if (error) return { ok: false, message: "캡션 저장에 실패했습니다." };
  }

  revalidatePath(`/toon/projects/${project.id}/final`);
  return { ok: true };
}
