import { redirect } from "next/navigation";
import { createClient } from "../../../../lib/supabase/server";
import NewCharacterForm from "./NewCharacterForm";

export default async function NewCharacterPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/toon/login");

  return (
    <main className="page">
      <div className="topbar">
        <h1>새 캐릭터 만들기</h1>
      </div>
      <div className="card">
        <NewCharacterForm />
      </div>
    </main>
  );
}
