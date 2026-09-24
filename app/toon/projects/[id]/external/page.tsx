import { notFound, redirect } from "next/navigation";
import { createClient } from "../../../../../lib/supabase/server";
import { getProject } from "../../../../../lib/projects/service";
import ExternalImageImporter from "./ExternalImageImporter";

export default async function ExternalImagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/toon/login");
  const project = await getProject(supabase, id);
  if (!project) notFound();
  if (project.panel_count !== 11 || project.status === "completed") redirect(`/toon/projects/${id}`);
  return (
    <main className="page">
      <div className="topbar"><h1>{project.title} — 외부 이미지로 제작</h1></div>
      <ExternalImageImporter projectId={id} />
    </main>
  );
}
