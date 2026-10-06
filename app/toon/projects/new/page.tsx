import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../../../lib/supabase/server";
import { getCharacters } from "../../../../lib/characters/service";
import { getSeriesCharacters, getSeriesList } from "../../../../lib/series/service";
import { getProject, getProjectCharacters } from "../../../../lib/projects/service";
import NewProjectForm from "./NewProjectForm";

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/toon/login");

  const { from } = await searchParams;
  const source = from && /^[a-f0-9-]{36}$/i.test(from) ? await getProject(supabase, from) : null;
  const sourceCharacters = source && source.user_id === user.id ? await getProjectCharacters(supabase, source.id) : [];
  const seed = source && source.user_id === user.id ? {title:`${source.title} · 다음 회차`,seriesId:source.series_id,characterIds:sourceCharacters.map(c=>c.id)} : undefined;
  const characters = await getCharacters(supabase);
  const seriesList = await getSeriesList(supabase);
  const seriesCharacterIds: Record<string, string[]> = {};
  for (const s of seriesList) {
    const seriesCharacters = await getSeriesCharacters(supabase, s.id);
    seriesCharacterIds[s.id] = seriesCharacters.map((c) => c.id);
  }

  return (
    <main className="page">
      <div className="topbar">
        <h1>새 프로젝트 만들기</h1>
      </div>

      {characters.length === 0 ? (
        <div className="empty-state">
          <p>{"먼저 캐릭터를 등록해야 프로젝트를 만들 수 있어요."}</p>
          <Link href="/toon/characters/new" className="btn btn-primary">
            캐릭터 만들러 가기
          </Link>
        </div>
      ) : (
        <div className="card">
          {seed && <p className="hint">이전 작품의 캐릭터와 시리즈 설정을 가져왔습니다. 새 제목과 소재를 입력하세요. 그림과 대사는 새로 준비하며, 저장한 작품 스타일은 편집기에서 불러올 수 있습니다.</p>}
          <NewProjectForm seed={seed}
            characters={characters.map((c) => ({ id: c.id, display_name: c.display_name, role: c.role ?? "" }))}
            series={seriesList.map((s) => ({ id: s.id, title: s.title }))}
            seriesCharacterIds={seriesCharacterIds}
          />
        </div>
      )}
    </main>
  );
}
