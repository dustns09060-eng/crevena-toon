"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { getProject, getProjectCharacters, getProjectPanels } from "./service";
import { getDefaultBubbleForIndex, getDefaultCoverTitleBubble, getDefaultNarrationBubble } from "../editor/bubbleLayout";
import { checkEditorReadiness } from "./editorUtils";
import {
  validateCoverTitleBubble,
  validateDialogueCharacterIds,
  validateNarrationBubble,
  validateToonDialogue,
} from "../../src/db/validation";
import type { ToonCoverTitleBubble, ToonDialogueItem, ToonNarrationBubble, ToonPanelType } from "../../src/db/types";

/**
 * STEP 7 — 이 파일은 절대 AI Provider(캐릭터 분석/스토리보드/이미지 생성)를
 * import하지 않는다. 말풍선 텍스트 편집·저장·최종 렌더 저장은 DB/Storage
 * 조작일 뿐이며, "대사 편집이 AI API를 0번 호출한다"는 STEP 7 §12 요구를
 * import 구조 자체로 보장하기 위함이다.
 */

const PANELS_BUCKET = "toon-panels";

type RequireOwnedProjectResult =
  | { error: string }
  | { supabase: Awaited<ReturnType<typeof createClient>>; user: { id: string }; project: NonNullable<Awaited<ReturnType<typeof getProject>>> };

async function requireOwnedProject(projectId: string): Promise<RequireOwnedProjectResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const project = await getProject(supabase, projectId);
  if (!project) return { error: "프로젝트를 찾을 수 없거나 접근 권한이 없습니다." };

  return { supabase, user, project };
}

export interface EditorPanelData {
  id: string;
  panelNumber: number;
  panelType: ToonPanelType;
  rawImageSignedUrl: string | null;
  dialogue: ToonDialogueItem[];
  narration: string | null;
  narrationBubble: ToonNarrationBubble | null;
  coverTitle: string | null;
  coverSubtitle: string | null;
  coverTitleBubble: ToonCoverTitleBubble | null;
}

export interface EditorProjectData {
  ok: true;
  projectId: string;
  panels: EditorPanelData[];
}

export interface EditorLoadError {
  ok: false;
  message: string;
  readinessErrors: string[];
}

/**
 * 편집기 화면이 처음 그려질 때 필요한 모든 데이터를 한 번에 모은다.
 * dialogue/narration에 아직 bubble 위치가 없으면(§3) 여기서 기본 배치를
 * "계산"만 해서 내려줄 뿐, DB에 즉시 저장하지는 않는다 — 사용자가 저장을
 * 눌러야 영속화된다.
 */
export async function getPanelEditorData(projectId: string): Promise<EditorProjectData | EditorLoadError> {
  const owned = await requireOwnedProject(projectId);
  if ("error" in owned) return { ok: false, message: owned.error, readinessErrors: [owned.error] };
  const { supabase, project } = owned;

  const panels = await getProjectPanels(supabase, project.id);
  const readiness = checkEditorReadiness(project, panels);
  if (!readiness.ready) {
    return { ok: false, message: "편집기에 진입할 수 없습니다.", readinessErrors: readiness.errors };
  }

  const panelData: EditorPanelData[] = [];
  for (const panel of panels) {
    let signedUrl: string | null = null;
    if (panel.raw_image_url) {
      const { data: signed } = await supabase.storage.from(PANELS_BUCKET).createSignedUrl(panel.raw_image_url, 3600);
      signedUrl = signed?.signedUrl ?? null;
    }

    const dialogue = panel.dialogue.map((item, index) => ({
      ...item,
      bubble: item.bubble ?? getDefaultBubbleForIndex(index),
    }));
    const narrationBubble = panel.narration ? (panel.narration_bubble ?? getDefaultNarrationBubble()) : null;
    const coverTitleBubble =
      panel.panel_type === "cover" && panel.cover_title ? (panel.cover_title_bubble ?? getDefaultCoverTitleBubble()) : null;

    panelData.push({
      id: panel.id,
      panelNumber: panel.panel_number,
      panelType: panel.panel_type,
      rawImageSignedUrl: signedUrl,
      dialogue,
      narration: panel.narration,
      narrationBubble,
      coverTitle: panel.cover_title,
      coverSubtitle: panel.cover_subtitle,
      coverTitleBubble,
    });
  }

  return { ok: true, projectId: project.id, panels: panelData };
}

export interface SaveBubbleLayoutState {
  ok: boolean;
  message?: string;
}

export async function saveBubbleLayoutAction(
  panelId: string,
  dialogue: ToonDialogueItem[],
  narration: string | null,
  narrationBubble: ToonNarrationBubble | null
): Promise<SaveBubbleLayoutState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "로그인이 필요합니다." };

  const { data: panelRow, error: fetchErr } = await supabase
    .from("toon_panels")
    .select("id, project_id")
    .eq("id", panelId)
    .maybeSingle();
  if (fetchErr || !panelRow) return { ok: false, message: "컷을 찾을 수 없거나 접근 권한이 없습니다." };

  const project = await getProject(supabase, panelRow.project_id);
  if (!project) return { ok: false, message: "컷을 찾을 수 없거나 접근 권한이 없습니다." };

  const dialogueValidation = validateToonDialogue(dialogue);
  if (!dialogueValidation.valid) {
    return { ok: false, message: `말풍선 데이터가 올바르지 않습니다: ${dialogueValidation.errors.join(", ")}` };
  }

  const projectCharacters = await getProjectCharacters(supabase, project.id);
  const characterIdCheck = validateDialogueCharacterIds(
    dialogue,
    projectCharacters.map((c) => c.id)
  );
  if (!characterIdCheck.valid) {
    return { ok: false, message: characterIdCheck.errors.join(", ") };
  }

  const narrationBubbleValidation = validateNarrationBubble(narrationBubble);
  if (!narrationBubbleValidation.valid) {
    return { ok: false, message: `내레이션 배치가 올바르지 않습니다: ${narrationBubbleValidation.errors.join(", ")}` };
  }

  const { error: updateErr } = await supabase
    .from("toon_panels")
    .update({ dialogue, narration, narration_bubble: narrationBubble })
    .eq("id", panelId);
  if (updateErr) return { ok: false, message: "저장에 실패했습니다." };

  revalidatePath(`/toon/projects/${project.id}/editor`);
  return { ok: true };
}

/**
 * 019 마이그레이션 — cover_title/cover_subtitle/cover_title_bubble은
 * dialogue/narration과 의미가 완전히 달라(표지 전용, panel_type='cover'인
 * 컷에서만 쓰임) saveBubbleLayoutAction과 별도 액션으로 분리한다.
 * scene 컷을 저장할 때 이 필드들을 실수로 건드릴 걱정도 없어진다.
 */
export async function saveCoverLayoutAction(
  panelId: string,
  coverTitle: string | null,
  coverSubtitle: string | null,
  coverTitleBubble: ToonCoverTitleBubble | null
): Promise<SaveBubbleLayoutState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "로그인이 필요합니다." };

  const { data: panelRow, error: fetchErr } = await supabase
    .from("toon_panels")
    .select("id, project_id")
    .eq("id", panelId)
    .maybeSingle();
  if (fetchErr || !panelRow) return { ok: false, message: "컷을 찾을 수 없거나 접근 권한이 없습니다." };

  const project = await getProject(supabase, panelRow.project_id);
  if (!project) return { ok: false, message: "컷을 찾을 수 없거나 접근 권한이 없습니다." };

  const bubbleValidation = validateCoverTitleBubble(coverTitleBubble);
  if (!bubbleValidation.valid) {
    return { ok: false, message: `표지 배치가 올바르지 않습니다: ${bubbleValidation.errors.join(", ")}` };
  }

  const { error: updateErr } = await supabase
    .from("toon_panels")
    .update({ cover_title: coverTitle, cover_subtitle: coverSubtitle, cover_title_bubble: coverTitleBubble })
    .eq("id", panelId);
  if (updateErr) return { ok: false, message: "저장에 실패했습니다." };

  revalidatePath(`/toon/projects/${project.id}/editor`);
  return { ok: true };
}

export interface SaveFinalRenderState {
  ok: boolean;
  message?: string;
  signedUrl?: string;
  storagePath?: string;
}

/**
 * STEP 7 §9, §10, §12 — 브라우저 canvas에서 이미 합성이 끝난 PNG를
 * 받아 Storage에만 저장한다. AI Provider를 전혀 호출하지 않으며,
 * 원본(raw) 경로는 절대 건드리지 않고 매번 새 render_id로 final/
 * 하위에 새 경로를 만든다.
 *
 * Server Action 인자로 Uint8Array를 직접 넘기면 React Flight
 * 직렬화가 이를 거대한 중첩 배열로 다뤄 "Maximum array nesting
 * exceeded" 오류가 난다(실측 확인). File/Blob은 멀티파트로 별도
 * 전송되므로 이 문제가 없어 File을 인자 타입으로 쓴다.
 */
export async function saveFinalRenderAction(panelId: string, pngFile: File): Promise<SaveFinalRenderState> {
  const pngBytes = new Uint8Array(await pngFile.arrayBuffer());
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "로그인이 필요합니다." };

  const { data: panelRow, error: fetchErr } = await supabase
    .from("toon_panels")
    .select("id, project_id, panel_number, raw_image_url")
    .eq("id", panelId)
    .maybeSingle();
  if (fetchErr || !panelRow) return { ok: false, message: "컷을 찾을 수 없거나 접근 권한이 없습니다." };
  if (!panelRow.raw_image_url) return { ok: false, message: "승인된 원본 이미지가 없는 컷은 최종 이미지를 만들 수 없습니다." };

  const project = await getProject(supabase, panelRow.project_id);
  if (!project) return { ok: false, message: "컷을 찾을 수 없거나 접근 권한이 없습니다." };

  const renderId = crypto.randomUUID();
  const storagePath = `${user.id}/${project.id}/final/${panelRow.panel_number}/${renderId}.png`;

  const { error: uploadErr } = await supabase.storage
    .from(PANELS_BUCKET)
    .upload(storagePath, pngBytes, { contentType: "image/png", upsert: false });
  if (uploadErr) return { ok: false, message: "최종 이미지 저장에 실패했습니다." };

  const { error: updateErr } = await supabase.from("toon_panels").update({ image_url: storagePath }).eq("id", panelId);
  if (updateErr) return { ok: false, message: "컷 정보 갱신에 실패했습니다." };

  const { data: signed } = await supabase.storage.from(PANELS_BUCKET).createSignedUrl(storagePath, 3600);

  revalidatePath(`/toon/projects/${project.id}/editor`);
  return { ok: true, signedUrl: signed?.signedUrl, storagePath };
}
