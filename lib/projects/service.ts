import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToonPanel, ToonProject } from "../../src/db/types";
import type { ProjectFormInput } from "./formValidation";

export interface ProjectCharacterContext {
  id: string;
  display_name: string;
  role: string;
  personality: string | null;
  speaking_style: string | null;
}

export async function createProject(
  supabase: SupabaseClient,
  input: ProjectFormInput
): Promise<ToonProject> {
  const { data, error } = await supabase
    .from("toon_projects")
    .insert({
      title: input.title,
      topic: input.topic,
      panel_count: input.panel_count,
      series_id: input.series_id ?? null,
    })
    .select()
    .single();
  if (error) throw error;

  if (input.character_ids.length > 0) {
    const rows = input.character_ids.map((characterId) => ({
      project_id: data.id,
      character_id: characterId,
    }));
    const { error: linkErr } = await supabase.from("toon_project_characters").insert(rows);
    if (linkErr) {
      // 프로젝트만 만들어지고 캐릭터 연결이 실패하면 (예: 타인 캐릭터 포함)
      // 고아 프로젝트가 남지 않도록 정리한다.
      await supabase.from("toon_projects").delete().eq("id", data.id);
      throw linkErr;
    }
  }

  return data as ToonProject;
}

export async function getProjects(supabase: SupabaseClient): Promise<ToonProject[]> {
  const { data, error } = await supabase
    .from("toon_projects")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ToonProject[];
}

export async function getProject(supabase: SupabaseClient, projectId: string): Promise<ToonProject | null> {
  const { data, error } = await supabase
    .from("toon_projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  return data as ToonProject | null;
}

export async function getProjectCharacters(
  supabase: SupabaseClient,
  projectId: string
): Promise<ProjectCharacterContext[]> {
  const { data, error } = await supabase
    .from("toon_project_characters")
    .select("toon_characters(id, display_name, role, personality, speaking_style)")
    .eq("project_id", projectId);
  if (error) throw error;

  return (data ?? [])
    .map((row: { toon_characters: ProjectCharacterContext | ProjectCharacterContext[] | null }) => {
      const c = Array.isArray(row.toon_characters) ? row.toon_characters[0] : row.toon_characters;
      return c;
    })
    .filter((c): c is ProjectCharacterContext => Boolean(c));
}

export async function getProjectPanels(supabase: SupabaseClient, projectId: string): Promise<ToonPanel[]> {
  const { data, error } = await supabase
    .from("toon_panels")
    .select("*")
    .eq("project_id", projectId)
    .order("panel_number", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ToonPanel[];
}

export type DeleteProjectResult = { deleted: true } | { deleted: false; reason: "not_found" };

const PANELS_BUCKET = "toon-panels";

/**
 * STEP 8 §16 — 프로젝트에는 raw/final/external 이미지가 Storage에 쌓여 있을 수
 * 있다. toon_projects 삭제는 FK CASCADE로 DB row는 정리해도 Storage
 * 객체는 절대 지우지 않으므로, 여기서 각 경로의 모든 객체를
 * 명시적으로 나열해서 지운다. 재렌더링으로 남는 "가리키지 않는" 이전
 * final 파일까지 정리하기 위해 DB에 기록된 경로 하나만 믿지 않고,
 * 각 컷의 raw/final/external 폴더를 Storage list()로 직접 조회한다.
 *
 * Character Sheet(toon-character-sheets 버킷)는 캐릭터 자산이므로
 * 이 함수는 절대 건드리지 않는다 — 프로젝트 삭제는 toon_characters에도
 * FK 영향이 없다(STEP 1 설계: toon_project_characters만 cascade).
 */
export async function cleanupProjectStorage(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  panelNumbers: number[],
  panelIds: string[] = []
): Promise<void> {
  const allPaths: string[] = [];
  async function listAll(prefix: string) {
    const entries: { name: string }[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.storage.from(PANELS_BUCKET).list(prefix, { limit: 1000, offset });
      if (error) throw error;
      entries.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return entries;
  }

  for (const panelNumber of panelNumbers) {
    for (const sub of ["raw", "final", "external"] as const) {
      const prefix = `${userId}/${projectId}/${sub}/${panelNumber}`;
      const { data: files, error } = await supabase.storage.from(PANELS_BUCKET).list(prefix);
      if (error) throw error;
      if (files && files.length > 0) {
        allPaths.push(...files.map((f: { name: string }) => `${prefix}/${f.name}`));
      }
    }
  }

  // Analysis cache lives only under this project's panel/image identity folders.
  for (const panelId of panelIds) {
    const panelPrefix = `${userId}/${projectId}/analysis/${panelId}`;
    for (const folder of await listAll(panelPrefix)) {
      const imagePrefix = `${panelPrefix}/${folder.name}`;
      allPaths.push(...(await listAll(imagePrefix)).filter((file) => file.name.endsWith(".json") || file.name.endsWith(".json.lock"))
        .map((file) => `${imagePrefix}/${file.name}`));
    }
  }

  if (allPaths.length > 0) {
    const { error } = await supabase.storage.from(PANELS_BUCKET).remove(allPaths);
    if (error) throw error;
  }
}

export async function deleteProject(supabase: SupabaseClient, projectId: string): Promise<DeleteProjectResult> {
  const project = await getProject(supabase, projectId);
  if (!project) return { deleted: false, reason: "not_found" };

  const panels = await getProjectPanels(supabase, projectId);
  await cleanupProjectStorage(supabase, project.user_id, projectId, panels.map((p) => p.panel_number), panels.map((p) => p.id));

  // toon_panels/toon_project_characters/toon_captions/toon_generations(project_id)는
  // FK ON DELETE CASCADE/SET NULL로 자동 정리된다 (STEP 1 설계).
  // toon_characters는 project_id에 종속되지 않으므로 영향받지 않는다
  // (Character Sheet는 캐릭터 자산이라 프로젝트 삭제로 지우면 안 된다).
  const { error } = await supabase.from("toon_projects").delete().eq("id", projectId);
  if (error) throw error;

  return { deleted: true };
}
