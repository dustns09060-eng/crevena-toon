import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "../../../../lib/supabase/server";
import { getSeries, getSeriesCharacters } from "../../../../lib/series/service";
import { getCharacters } from "../../../../lib/characters/service";
import SeriesCharacterManager from "./SeriesCharacterManager";

export default async function SeriesDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/toon/login");

  const series = await getSeries(supabase, id);
  if (!series) notFound();

  const [seriesCharacters, allCharacters] = await Promise.all([
    getSeriesCharacters(supabase, id),
    getCharacters(supabase),
  ]);

  return (
    <main className="page">
      <div className="topbar">
        <h1>{series.title}</h1>
        <Link href="/toon/series" className="btn">
          시리즈 목록
        </Link>
      </div>

      <p className="hint">
        여기서 연결한 캐릭터는 이 시리즈의 새 에피소드를 만들 때 바로 다시 선택할 수 있어요. 기존
        Character Bible/Character Sheet를 그대로 재사용하며, 새로 만들지 않습니다.
      </p>

      <SeriesCharacterManager
        seriesId={series.id}
        allCharacters={allCharacters.map((c) => ({ id: c.id, display_name: c.display_name, role: c.role ?? "" }))}
        initialLinkedIds={seriesCharacters.map((c) => c.id)}
      />
    </main>
  );
}
