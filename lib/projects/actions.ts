"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "../supabase/server";
import { validateProjectForm } from "./formValidation";
import * as projectService from "./service";

export interface CreateProjectState {
  ok: boolean;
  errors?: Record<string, string>;
  message?: string;
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/toon/login");
  return { supabase, user };
}

export async function createProjectAction(
  _prev: CreateProjectState,
  formData: FormData
): Promise<CreateProjectState> {
  const { supabase } = await requireUser();

  const seriesIdRaw = String(formData.get("series_id") ?? "");
  const raw = {
    title: String(formData.get("title") ?? ""),
    topic: String(formData.get("topic") ?? ""),
    panel_count: Number(formData.get("panel_count") ?? 8),
    character_ids: formData.getAll("character_ids").map(String),
    series_id: seriesIdRaw.length > 0 ? seriesIdRaw : null,
  };

  const validation = validateProjectForm(raw);
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }

  let project;
  try {
    project = await projectService.createProject(supabase, validation.data);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "프로젝트 생성 중 오류가 발생했습니다." };
  }

  revalidatePath("/toon/projects");
  redirect(`/toon/projects/${project.id}`);
}

export async function deleteProjectAction(
  projectId: string
): Promise<{ ok: boolean; message?: string }> {
  const { supabase } = await requireUser();

  try {
    const result = await projectService.deleteProject(supabase, projectId);
    if (!result.deleted) {
      return { ok: false, message: "프로젝트를 찾을 수 없거나 접근 권한이 없습니다." };
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다." };
  }

  revalidatePath("/toon/projects");
  return { ok: true };
}
