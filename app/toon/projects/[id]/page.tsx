import { notFound, redirect } from "next/navigation";
import { createClient } from "../../../../lib/supabase/server";
import { getProject, getProjectCharacters, getProjectPanels } from "../../../../lib/projects/service";
import { checkProjectGenerationReadiness, getPanelImagesSummary } from "../../../../lib/projects/panelImages";
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
        initialPanels={panels}
        panelImagesData={panelImagesData}
      />
    </main>
  );
}
