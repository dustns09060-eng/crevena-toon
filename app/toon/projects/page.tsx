import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { getProjectPanels, getProjects } from "../../../lib/projects/service";
import { getProjectStatusLabel } from "../../../lib/projects/finalUtils";
import DeleteProjectButton from "./DeleteProjectButton";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/toon/login");

  const projects = await getProjects(supabase);
  const statusLabels = await Promise.all(
    projects.map(async (p) => getProjectStatusLabel(p, await getProjectPanels(supabase, p.id)))
  );

  return (
    <main className="page">
      <div className="topbar">
        <h1>인스타툰 프로젝트</h1>
        <Link href="/toon/characters" className="btn">
          캐릭터
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="empty-state">
          <p>{"아직 만든 프로젝트가 없어요.\n소재를 정하고 스토리보드를 만들어보세요."}</p>
          <Link href="/toon/projects/new" className="btn btn-primary">
            새 프로젝트 만들기
          </Link>
        </div>
      ) : (
        <>
          <div className="char-list">
            {projects.map((p, i) => (
              <div className="card char-card" key={p.id}>
                <div className="char-card__body">
                  <div className="char-card__name">{p.title}</div>
                  <div className="char-card__role">
                    {p.panel_count}컷 · {statusLabels[i]} · {new Date(p.created_at).toLocaleDateString("ko-KR")}
                  </div>
                </div>
                <div className="char-card__actions">
                  {p.status === "completed" ? (
                    <Link href={`/toon/projects/${p.id}/final`} className="btn btn-primary">
                      보기/다운로드
                    </Link>
                  ) : (
                    <Link
                      href={
                        p.status === "confirmed" || p.status === "generating" || p.status === "failed"
                          ? `/toon/projects/${p.id}/images`
                          : `/toon/projects/${p.id}`
                      }
                      className="btn"
                    >
                      {p.status === "confirmed" || p.status === "generating" || p.status === "failed"
                        ? "이미지 컷"
                        : "스토리보드"}
                    </Link>
                  )}
                  <DeleteProjectButton projectId={p.id} projectTitle={p.title} />
                </div>
              </div>
            ))}
          </div>
          <Link href="/toon/projects/new" className="btn btn-primary btn-block">
            새 프로젝트 만들기
          </Link>
        </>
      )}
    </main>
  );
}
