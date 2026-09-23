import { notFound, redirect } from "next/navigation";
import { createClient } from "../../../../lib/supabase/server";
import { getProject, getProjectCharacters, getProjectPanels } from "../../../../lib/projects/service";
import { checkProjectGenerationReadiness, getPanelImagesSummary } from "../../../../lib/projects/panelImages";
import { getCharacters } from "../../../../lib/characters/service";
import { getSeriesLocations } from "../../../../lib/series/service";
import StoryboardEditor from "./StoryboardEditor";

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

  let panelImagesData = null;
  if (project.status === "confirmed" && panels.length > 0) {
    const readiness = await checkProjectGenerationReadiness(supabase, project, panels);
    const summary = await getPanelImagesSummary(supabase, panels);
    panelImagesData = {
      readinessErrors: readiness.errors,
      images: Object.fromEntries(
        panels.map((p) => [
          p.id,
          { approved: summary.approvedByPanel[p.id], candidate: summary.candidateByPanel[p.id] },
        ])
      ),
    };
  }

  return (
    <main className="page">
      <div className="topbar">
        <h1>{project.title}</h1>
      </div>

      <StoryboardEditor
        project={project}
        characters={characters}
        allCharacters={allCharacters.map((c) => ({ id: c.id, display_name: c.display_name, role: c.role ?? "" }))}
        allLocations={seriesLocations.map((l) => ({ id: l.id, display_name: l.display_name }))}
        initialPanels={panels}
        panelImagesData={panelImagesData}
      />
    </main>
  );
}
