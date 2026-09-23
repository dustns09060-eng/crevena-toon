"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { getProject, getProjectCharacters, getProjectPanels } from "./service";
import { getStoryboardProvider } from "../../src/providers/storyboardProviderRegistry";
import { validateStoryboardAgainstProject } from "../../src/providers/storyboardSchema";
import {
  buildNameToIdMap,
  mapStoryboardRawToDraft,
  type StoryboardDraft,
} from "../../src/providers/storyboardMapper";
import { validateToonDialogue } from "../../src/db/validation";

const inFlightStoryboardGeneration = new Set<string>();

export interface GenerateStoryboardState {
  ok: boolean;
  message?: string;
  draft?: StoryboardDraft;
}

async function requireOwnedProject(projectId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." as const };

  // getProject는 RLS로 스코프되므로 남의 project_id면 null이 되어
  // 별도 소유권 비교 없이 타인 프로젝트 요청이 차단된다.
  const project = await getProject(supabase, projectId);
  if (!project) return { error: "프로젝트를 찾을 수 없거나 접근 권한이 없습니다." as const };

  return { supabase, user, project };
}

export async function generateStoryboardAction(projectId: string): Promise<GenerateStoryboardState> {
  const owned = await requireOwnedProject(projectId);
  if ("error" in owned) return { ok: false, message: owned.error };
  const { supabase, project } = owned;

  if (inFlightStoryboardGeneration.has(projectId)) {
    return { ok: false, message: "이미 이 프로젝트의 스토리보드를 생성하고 있습니다. 잠시만 기다려주세요." };
  }
  inFlightStoryboardGeneration.add(projectId);

  try {
    const characters = await getProjectCharacters(supabase, projectId);
    if (characters.length === 0) {
      return { ok: false, message: "프로젝트에 연결된 캐릭터가 없습니다." };
    }
    if (!project.topic) {
      return { ok: false, message: "소재가 설정되지 않았습니다." };
    }

    const provider = getStoryboardProvider();
    const raw = await provider.generateStoryboard({
      topic: project.topic,
      panelCount: project.panel_count,
      characters,
    });

    const validation = validateStoryboardAgainstProject(raw, {
      expectedPanelCount: project.panel_count,
      allowedCharacterNames: characters.map((c) => c.display_name),
    });
    if (!validation.valid) {
      return {
        ok: false,
        message: "AI 스토리보드 결과가 유효하지 않아 사용할 수 없습니다: " + validation.errors.join(" / "),
      };
    }

    const nameToId = buildNameToIdMap(characters);
    const draft = mapStoryboardRawToDraft(raw, nameToId);

    return { ok: true, draft };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "스토리보드 생성 중 오류가 발생했습니다." };
  } finally {
    inFlightStoryboardGeneration.delete(projectId);
  }
}

export interface SaveStoryboardState {
  ok: boolean;
  message?: string;
}

export async function saveStoryboardAction(
  projectId: string,
  draft: StoryboardDraft
): Promise<SaveStoryboardState> {
  const owned = await requireOwnedProject(projectId);
  if ("error" in owned) return { ok: false, message: owned.error };
  const { supabase, project } = owned;

  if (draft.panels.length !== project.panel_count) {
    return {
      ok: false,
      message: `panel 개수(${draft.panels.length})가 프로젝트 컷 수(${project.panel_count})와 다릅니다.`,
    };
  }

  const characters = await getProjectCharacters(supabase, projectId);
  const allowedIds = new Set(characters.map((c) => c.id));

  const rows = [];
  for (const [index, panel] of draft.panels.entries()) {
    if (panel.panel_number !== index + 1) {
      return { ok: false, message: "panel_number가 1부터 연속되지 않습니다." };
    }
    for (const cid of panel.character_ids) {
      if (!allowedIds.has(cid)) {
        return { ok: false, message: "허용되지 않은 캐릭터가 포함되어 있습니다." };
      }
    }

    const dialogue = panel.dialogue.map((d) => ({
      id: d.id,
      character_id: d.character_id,
      text: d.text,
      bubble_type: "speech" as const,
      bubble: null,
    }));

    for (const line of dialogue) {
      if (!panel.character_ids.includes(line.character_id)) {
        return { ok: false, message: "대사 화자가 이 컷의 등장인물 목록에 없습니다." };
      }
    }

    const dialogueValidation = validateToonDialogue(dialogue);
    if (!dialogueValidation.valid) {
      return { ok: false, message: "대사 형식이 올바르지 않습니다: " + dialogueValidation.errors.join(" / ") };
    }

    rows.push({
      project_id: projectId,
      panel_number: panel.panel_number,
      scene: panel.scene_description,
      narration: panel.narration,
      dialogue,
      character_ids: panel.character_ids,
      expression: panel.expression,
      image_prompt: panel.image_prompt,
    });
  }

  const { error: upsertErr } = await supabase
    .from("toon_panels")
    .upsert(rows, { onConflict: "project_id,panel_number" });
  if (upsertErr) {
    return { ok: false, message: "저장 중 오류가 발생했습니다: " + upsertErr.message };
  }

  const updates: Record<string, unknown> = { story_summary: draft.summary };
  if (project.status === "draft") updates.status = "storyboard";
  const { error: projErr } = await supabase.from("toon_projects").update(updates).eq("id", projectId);
  if (projErr) {
    return { ok: false, message: "프로젝트 상태 갱신 중 오류가 발생했습니다: " + projErr.message };
  }

  revalidatePath(`/toon/projects/${projectId}`);
  return { ok: true };
}

export async function confirmStoryboardAction(projectId: string): Promise<SaveStoryboardState> {
  const owned = await requireOwnedProject(projectId);
  if ("error" in owned) return { ok: false, message: owned.error };
  const { supabase, project } = owned;

  const panels = await getProjectPanels(supabase, projectId);
  if (panels.length !== project.panel_count) {
    return { ok: false, message: "스토리보드를 먼저 저장해주세요 (컷 수가 일치하지 않습니다)." };
  }

  const { error } = await supabase.from("toon_projects").update({ status: "confirmed" }).eq("id", projectId);
  if (error) return { ok: false, message: "확정 중 오류가 발생했습니다." };

  revalidatePath(`/toon/projects/${projectId}`);
  return { ok: true };
}
