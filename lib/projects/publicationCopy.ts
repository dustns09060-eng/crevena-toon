"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { getProject, getProjectCharacters, getProjectPanels } from "./service";
import { getProjectLocations } from "./projectLocations";
import { selectPublicationPanels } from "./publicationSelection";

export async function createPublicationCopyAction(sourceId: string, numbers: number[], title: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, message: "로그인이 필요합니다." };
  let newId: string | null = null;
  const copiedPaths: string[] = [];
  try {
    const source = await getProject(supabase, sourceId);
    if (!source || source.user_id !== user.id) throw new Error("원본에 접근할 수 없습니다.");
    if (!title.trim() || title.trim().length > 100) throw new Error("제목은 1~100자로 입력해주세요.");
    const panels = selectPublicationPanels(await getProjectPanels(supabase, sourceId), numbers);
    const [characters, locations] = await Promise.all([
      getProjectCharacters(supabase, sourceId), getProjectLocations(supabase, sourceId),
    ]);
    const { data: project, error } = await supabase.from("toon_projects").insert({
      title: title.trim(), topic: source.topic, category: source.category, tone: source.tone,
      series_id: source.series_id, story_summary: source.story_summary,
      panel_count: panels.length, status: "confirmed",
    }).select("id").single();
    if (error || !project) throw new Error("편집본을 만들지 못했습니다.");
    newId = project.id;
    if (characters.length) {
      const result = await supabase.from("toon_project_characters").insert(characters.map((c) => ({ project_id: newId, character_id: c.id })));
      if (result.error) throw new Error("캐릭터를 복사하지 못했습니다.");
    }
    const locationMap = new Map<string, string>();
    for (const location of locations.filter((l) => panels.some((p) => p.project_location_id === l.id))) {
      const { id, created_at: _created, ...fields } = location;
      const result = await supabase.from("toon_project_locations").insert({ ...fields, project_id: newId }).select("id").single();
      if (result.error) throw new Error("장소를 복사하지 못했습니다.");
      locationMap.set(id, result.data.id);
    }
    // Copy actual objects into the new project: deleting either edition cannot break the other.
    for (const [index, panel] of panels.entries()) {
      const number = index + 1;
      const paths: Record<string, string> = {};
      for (const [kind, original] of [["raw", panel.raw_image_url], ["final", panel.image_url]] as const) {
        const path = `${user.id}/${newId}/${kind}/${number}/publication.png`;
        const result = await supabase.storage.from("toon-panels").copy(original!, path);
        if (result.error) throw new Error("이미지 파일 복사에 실패했습니다.");
        copiedPaths.push(path);
        paths[kind] = path;
      }
      const { id: _id, created_at: _created, updated_at: _updated, ...fields } = panel;
      const result = await supabase.from("toon_panels").insert({
        ...fields, project_id: newId, panel_number: number,
        raw_image_url: paths.raw, image_url: paths.final, generation_version: 1,
        project_location_id: panel.project_location_id ? locationMap.get(panel.project_location_id) : null,
      }).select("id").single();
      if (result.error) throw new Error("컷 복사에 실패했습니다.");
      const imageResult = await supabase.from("toon_panel_images").insert({
        panel_id: result.data.id, provider: "publication-copy", model: "original-approved-image",
        status: "approved", storage_path: paths.raw, generation_version: 1,
        prompt_snapshot: panel.image_prompt ?? "원본 승인 이미지 복사",
      });
      if (imageResult.error) throw new Error("승인 이미지 기록을 복사하지 못했습니다.");
    }
    revalidatePath("/toon/projects");
    return { ok: true as const, projectId: newId! };
  } catch (error) {
    // Roll back only the newly created copy, never the source project or assets.
    if (copiedPaths.length) await supabase.storage.from("toon-panels").remove(copiedPaths);
    if (newId) await supabase.from("toon_projects").delete().eq("id", newId).eq("user_id", user.id);
    return { ok: false as const, message: error instanceof Error ? error.message : "복사에 실패했습니다." };
  }
}
