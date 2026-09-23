import { notFound, redirect } from "next/navigation";
import { createClient } from "../../../../lib/supabase/server";
import { getLocation } from "../../../../lib/locations/service";
import { updateLocationAction } from "../../../../lib/locations/actions";
import LocationForm from "../LocationForm";
import DeleteLocationButton from "./DeleteLocationButton";

export default async function LocationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/toon/login");

  const location = await getLocation(supabase, id);
  if (!location) notFound();

  const boundAction = updateLocationAction.bind(null, id);

  return (
    <main className="page">
      <div className="topbar">
        <h1>{location.display_name}</h1>
      </div>

      <div className="card">
        <LocationForm action={boundAction} location={location} submitLabel="저장" />
      </div>

      <div className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>장소 삭제</h2>
        <p className="hint">이 장소를 사용 중인 컷(panel)이 있다면, 그 컷의 장소 연결만 해제되고 컷 자체는 남습니다.</p>
        <DeleteLocationButton locationId={id} locationName={location.display_name} />
      </div>
    </main>
  );
}
