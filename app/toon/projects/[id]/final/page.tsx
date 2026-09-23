import { redirect } from "next/navigation";
import { createClient } from "../../../../../lib/supabase/server";
import { getFinalPageData } from "../../../../../lib/projects/finalPage";
import FinalClient from "./FinalClient";

export default async function FinalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/toon/login");

  const data = await getFinalPageData(id);
  if (!data.ok) {
    redirect(`/toon/projects/${id}`);
  }

  return (
    <main className="page-wide">
      <div className="topbar">
        <h1>{data.project.title} — 최종 확인</h1>
      </div>
      <FinalClient
        projectId={data.project.id}
        projectTitle={data.project.title}
        projectStatus={data.project.status}
        panels={data.panels}
        readiness={data.readiness}
        initialCaption={data.caption}
      />
    </main>
  );
}
