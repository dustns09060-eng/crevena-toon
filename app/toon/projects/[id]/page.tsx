import { notFound, redirect } from "next/navigation";
import { createClient } from "../../../../lib/supabase/server";
import { getProject, getProjectCharacters, getProjectPanels } from "../../../../lib/projects/service";
import { getCharacters } from "../../../../lib/characters/service";
import { getSeriesLocations } from "../../../../lib/series/service";
import { getProjectLocations } from "../../../../lib/projects/projectLocations";
import StoryboardEditor from "./StoryboardEditor";
import ProjectStageNav from "./ProjectStageNav";
import Link from "next/link";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/toon/login");

  const project = await getProject(supabase, id);
  if (!project) notFound();

  const characters = await getProjectCharacters(supabase, id);
  const panels = await getProjectPanels(supabase, id);
  const allCharacters = await getCharacters(supabase);
  // 021 — 이 프로젝트가 속한 시리즈의 Location Set만 보여준다(전역
  // 장소 전체가 아니라, Storyboard AI가 실제로 고를 수 있었던 목록과
  // 동일한 범위). 독립 프로젝트(series_id=null)는 항상 빈 배열.
  const seriesLocations = project.series_id ? await getSeriesLocations(supabase, project.series_id) : [];
  // 022 — 이 프로젝트(에피소드)가 지금까지 정의한 Temporary Location.
  // 사용자는 직접 만들지 않고 Storyboard AI가 저장 시점에 채운다.
  const projectLocations = await getProjectLocations(supabase, id);

  const imagesEnabled = project.status === "confirmed" || project.status === "generating" || project.status === "failed";

  return (
    <main className="page">
      <div className="topbar">
        <div>
          <p className="page-eyebrow">스토리보드</p>
          <h1>{project.title}</h1>
        </div>
      </div>

      <ProjectStageNav projectId={id} active="storyboard" imagesEnabled={imagesEnabled} />

      {project.panel_count === 11 && project.status !== "completed" && (
        <div className="card">
          <Link className="btn btn-primary" href={`/toon/projects/${id}/external`}>외부 이미지로 제작</Link>
          <p className="hint">AI 호출 없이 표지 1장과 본문 10장을 가져옵니다. 기존 이미지는 자동 교체하지 않습니다.</p>
        </div>
      )}

      <StoryboardEditor
        project={project}
        characters={characters}
        allCharacters={allCharacters.map((c) => ({ id: c.id, display_name: c.display_name, role: c.role ?? "" }))}
        allLocations={seriesLocations.map((l) => ({ id: l.id, display_name: l.display_name }))}
        projectLocations={projectLocations.map((l) => ({
          id: l.id,
          location_key: l.location_key,
          display_name: l.display_name,
          visual_prompt: l.visual_prompt,
          wall_and_floor: l.wall_and_floor,
          fixed_furniture: l.fixed_furniture,
          window_style: l.window_style,
          recurring_props: l.recurring_props,
          distinctive_features: l.distinctive_features,
        }))}
        initialPanels={panels}
      />
    </main>
  );
}
