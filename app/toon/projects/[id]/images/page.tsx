import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "../../../../../lib/supabase/server";
import { getProject, getProjectPanels } from "../../../../../lib/projects/service";
import { checkProjectGenerationReadiness, getPanelImagesSummary } from "../../../../../lib/projects/panelImages";
import { getSeriesLocations } from "../../../../../lib/series/service";
import { getProjectLocations } from "../../../../../lib/projects/projectLocations";
import PanelImageGenerator from "../PanelImageGenerator";
import ProjectStageNav from "../ProjectStageNav";

export default async function ProjectImagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/toon/login");

  const project = await getProject(supabase, id);
  if (!project) notFound();
  if (project.status === "completed") redirect(`/toon/projects/${id}/final`);

  const panels = await getProjectPanels(supabase, id);
  const imagesEnabled = project.status === "confirmed" || project.status === "generating" || project.status === "failed";

  if (!imagesEnabled) {
    return (
      <main className="page">
        <div className="topbar">
          <div>
            <p className="page-eyebrow">이미지 컷</p>
            <h1>{project.title}</h1>
          </div>
        </div>
        <ProjectStageNav projectId={id} active="images" imagesEnabled={false} />
        <div className="card">
          <h2 style={{ fontSize: 17, marginTop: 0 }}>스토리보드를 먼저 확정해주세요</h2>
          <p className="hint">장면과 대사를 확정한 뒤 이미지 컷을 만들 수 있어요.</p>
          <Link href={`/toon/projects/${id}`} className="btn btn-primary btn-block">
            스토리보드로 돌아가기
          </Link>
        </div>
      </main>
    );
  }

  const [readiness, summary, seriesLocations, projectLocations] = await Promise.all([
    checkProjectGenerationReadiness(supabase, project, panels),
    getPanelImagesSummary(supabase, panels),
    project.series_id ? getSeriesLocations(supabase, project.series_id) : Promise.resolve([]),
    getProjectLocations(supabase, id),
  ]);

  const images = Object.fromEntries(
    panels.map((panel) => [
      panel.id,
      { approved: summary.approvedByPanel[panel.id], candidate: summary.candidateByPanel[panel.id] },
    ])
  );

  return (
    <main className="page">
      <div className="topbar">
        <div>
          <p className="page-eyebrow">이미지 컷</p>
          <h1>{project.title}</h1>
        </div>
      </div>

      <ProjectStageNav projectId={id} active="images" imagesEnabled />

      <div className="card workflow-intro">
        <h2>이미지 컷 만들기</h2>
        <p className="hint">확정된 스토리보드를 기준으로 그림을 만들고, 사용할 이미지를 컷별로 선택하세요.</p>
      </div>

      <PanelImageGenerator
        panels={panels}
        initialImages={images}
        initialReadinessErrors={readiness.errors}
        allLocations={seriesLocations.map((location) => ({ id: location.id, display_name: location.display_name }))}
        projectLocations={projectLocations.map((location) => ({
          id: location.id,
          location_key: location.location_key,
          display_name: location.display_name,
        }))}
      />
    </main>
  );
}
