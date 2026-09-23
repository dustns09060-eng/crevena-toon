import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToonProjectLocation } from "../../src/db/types";

/**
 * 022 — Temporary/Story Location(toon_project_locations) 조회 전용
 * 서비스. 쓰기(upsert/삭제)는 toon_save_storyboard_panels RPC 안에서만
 * 일어난다(lib/projects/storyboard.ts) — 이 파일은 읽기만 제공한다.
 */
export async function getProjectLocations(
  supabase: SupabaseClient,
  projectId: string
): Promise<ToonProjectLocation[]> {
  const { data, error } = await supabase
    .from("toon_project_locations")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ToonProjectLocation[];
}

export async function getProjectLocation(
  supabase: SupabaseClient,
  id: string
): Promise<ToonProjectLocation | null> {
  const { data, error } = await supabase.from("toon_project_locations").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as ToonProjectLocation | null;
}
