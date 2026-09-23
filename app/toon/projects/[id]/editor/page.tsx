import { notFound, redirect } from "next/navigation";
import { createClient } from "../../../../../lib/supabase/server";
import { getProject, getProjectCharacters, getProjectPanels } from "../../../../../lib/projects/service";
import { checkEditorReadiness } from "../../../../../lib/projects/editorUtils";
import { getPanelEditorData } from "../../../../../lib/projects/editor";
import EditorClient from "./EditorClient";

/**
 * STEP 7 §1 — "모든 컷이 승인되어야 편집기에 진입 가능"을 서버에서도
 * 강제한다. 클라이언트 버튼 비활성화만으로는 URL을 직접 입력해
 * 우회할 수 있으므로, 이 페이지 자체가 checkEditorReadiness()를 다시
 * 검사해 조건 미충족 시 프로젝트 목록으로 되돌려보낸다.
 */
export default async function PanelEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ panel?: string }>;
}) {
  const { id } = await params;
  const { panel: panelParam } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/toon/login");

  const project = await getProject(supabase, id);
  if (!project) notFound();

  // STEP 8 §14 — 완성(completed) 처리된 프로젝트는 실수로 바뀌지 않도록
  // 바로 편집기로 들어올 수 없다. "다시 편집하기"(reopenProjectAction)를
  // 먼저 거쳐 상태를 confirmed로 되돌려야만 여기 들어올 수 있다.
  if (project.status === "completed") {
    redirect(`/toon/projects/${id}/final`);
  }

  const panels = await getProjectPanels(supabase, id);
  const readiness = checkEditorReadiness(project, panels);
  if (!readiness.ready) {
    redirect(`/toon/projects/${id}`);
  }

  const editorData = await getPanelEditorData(id);
  if (!editorData.ok) {
    redirect(`/toon/projects/${id}`);
  }

  const characters = await getProjectCharacters(supabase, id);

  const requestedPanelNumber = panelParam ? Number(panelParam) : null;
  const initialPanelIndex = requestedPanelNumber
    ? Math.max(0, editorData.panels.findIndex((p) => p.panelNumber === requestedPanelNumber))
    : 0;

  return (
    <main className="page">
      <div className="topbar">
        <h1>{project.title} — 말풍선 편집</h1>
      </div>
      <EditorClient initialPanels={editorData.panels} characters={characters} initialPanelIndex={initialPanelIndex} />
    </main>
  );
}
