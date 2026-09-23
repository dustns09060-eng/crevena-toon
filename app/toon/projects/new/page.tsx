import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../../../lib/supabase/server";
import { getCharacters } from "../../../../lib/characters/service";
import { getSeriesCharacters, getSeriesList } from "../../../../lib/series/service";
import NewProjectForm from "./NewProjectForm";

export default async function NewProjectPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/toon/login");

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
          <NewProjectForm
            characters={characters.map((c) => ({ id: c.id, display_name: c.display_name, role: c.role ?? "" }))}
            series={seriesList.map((s) => ({ id: s.id, title: s.title }))}
            seriesCharacterIds={seriesCharacterIds}
          />
        </div>
      )}
    </main>
  );
}
