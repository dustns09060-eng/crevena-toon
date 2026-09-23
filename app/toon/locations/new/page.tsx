import { redirect } from "next/navigation";
import { createClient } from "../../../../lib/supabase/server";
import { createLocationAction } from "../../../../lib/locations/actions";
import LocationForm from "../LocationForm";

export default async function NewLocationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/toon/login");

  return (
    <main className="page">
      <div className="topbar">
        <h1>새 장소 만들기</h1>
      </div>
      <div className="card">
        <LocationForm action={createLocationAction} submitLabel="장소 만들기" />
      </div>
    </main>
  );
}
