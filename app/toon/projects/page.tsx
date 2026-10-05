/* eslint-disable @next/next/no-img-element */
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
  const panelGroups = await Promise.all(projects.map((p) => getProjectPanels(supabase, p.id)));
  const statusLabels = projects.map((p, index) => getProjectStatusLabel(p, panelGroups[index]));
  const thumbnails = await Promise.all(panelGroups.map(async (panels) => {
    const cover = panels.find((panel) => panel.panel_type === "cover") ?? panels[0];
    const path = cover?.image_url ?? cover?.raw_image_url;
    if (!path) return null;
    const { data } = await supabase.storage.from("toon-panels").createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  }));

  return (
    <main className="page-wide library-page">
      <div className="topbar">
        <div><p className="page-eyebrow">CREVENA STUDIO</p><h1>내 작품</h1><p className="hint">이야기를 시작하고, 그림을 다듬고, 연재를 완성하세요.</p></div>
        <Link href="/toon/projects/new" className="btn">
          + 새 작품
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
          <div className="library-grid">
            {projects.map((p, i) => (
              <article className="card library-card" key={p.id}>
                <Link href={`/toon/projects/${p.id}${p.status === "completed" ? "/final" : ""}`} className="library-card__art" aria-label={`${p.title} 열기`}>
                  {thumbnails[i] ? <img src={thumbnails[i]!} alt={`${p.title} 표지`} loading="lazy" /> : <span>새 이야기를 기다리는 중</span>}
                </Link>
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
                  <details className="library-menu"><summary aria-label={`${p.title} 관리`}>관리</summary><DeleteProjectButton projectId={p.id} projectTitle={p.title} /></details>
                </div>
              </article>
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
