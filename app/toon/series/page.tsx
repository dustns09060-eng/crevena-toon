import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { getSeriesList } from "../../../lib/series/service";
import SeriesCreateForm from "./SeriesCreateForm";

export default async function SeriesListPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/toon/login");

  const seriesList = await getSeriesList(supabase);

  return (
    <main className="page">
      <div className="topbar">
        <h1>시리즈</h1>
        <Link href="/toon/characters" className="btn">
          캐릭터
        </Link>
        <Link href="/toon/locations" className="btn">
          장소
        </Link>
      </div>

      {seriesList.length === 0 ? (
        <p className="hint">
          아직 만든 시리즈가 없어요. 시리즈를 만들면 등장인물을 묶어두고 다음 에피소드에서도 바로 재사용할 수 있어요.
        </p>
      ) : (
        <div className="char-list">
          {seriesList.map((s) => (
            <div className="card char-card" key={s.id}>
              <div className="char-card__body">
                <div className="char-card__name">{s.title}</div>
              </div>
              <div className="char-card__actions">
                <Link href={`/toon/series/${s.id}`} className="btn">
                  등장인물 관리
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <SeriesCreateForm />
      </div>
    </main>
  );
}
