import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { getLocations } from "../../../lib/locations/service";

export default async function LocationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/toon/login");

  const locations = await getLocations(supabase);

  return (
    <main className="page">
      <div className="topbar">
        <h1>내 장소</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/toon/characters" className="btn">
            캐릭터
          </Link>
          <Link href="/toon/series" className="btn">
            시리즈
          </Link>
        </div>
      </div>

      <p className="hint">
        여기서 만든 장소는 시리즈의 Location Set으로 연결해, 여러 화(에피소드)에서 같은 집(거실/침실/주방 등)을
        계속 재사용할 수 있어요.
      </p>

      {locations.length === 0 ? (
        <div className="empty-state">
          <p>{"아직 등록된 장소가 없어요.\n우리 집 거실처럼 자주 나올 장소를 만들어보세요."}</p>
          <Link href="/toon/locations/new" className="btn btn-primary">
            첫 장소 만들기
          </Link>
        </div>
      ) : (
        <>
          <div className="char-list">
            {locations.map((l) => (
              <div className="card char-card" key={l.id}>
                <div className="char-card__body">
                  <div className="char-card__name">{l.display_name}</div>
                  <div className="char-card__role">{l.visual_prompt}</div>
                </div>
                <div className="char-card__actions">
                  <Link href={`/toon/locations/${l.id}`} className="btn">
                    수정
                  </Link>
                </div>
              </div>
            ))}
          </div>
          <Link href="/toon/locations/new" className="btn btn-primary btn-block">
            새 장소 만들기
          </Link>
        </>
      )}
    </main>
  );
}
