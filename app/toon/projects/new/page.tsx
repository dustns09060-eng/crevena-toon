import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../../../lib/supabase/server";
import { getCharacters } from "../../../../lib/characters/service";
import NewProjectForm from "./NewProjectForm";

export default async function NewProjectPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/toon/login");

  const characters = await getCharacters(supabase);

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
          />
        </div>
      )}
    </main>
  );
}
