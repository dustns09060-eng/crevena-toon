import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToonLocation } from "../../src/db/types";
import type { LocationFormInput } from "./formValidation";

export async function createLocation(supabase: SupabaseClient, input: LocationFormInput): Promise<ToonLocation> {
  const { data, error } = await supabase
    .from("toon_locations")
    .insert({
      display_name: input.display_name,
      visual_prompt: input.visual_prompt,
      wall_and_floor: input.wall_and_floor || null,
      fixed_furniture: input.fixed_furniture || null,
      window_style: input.window_style || null,
      recurring_props: input.recurring_props || null,
      distinctive_features: input.distinctive_features || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data as ToonLocation;
}

export async function updateLocation(
  supabase: SupabaseClient,
  locationId: string,
  input: LocationFormInput
): Promise<ToonLocation> {
  const { data, error } = await supabase
    .from("toon_locations")
    .update({
      display_name: input.display_name,
      visual_prompt: input.visual_prompt,
      wall_and_floor: input.wall_and_floor || null,
      fixed_furniture: input.fixed_furniture || null,
      window_style: input.window_style || null,
      recurring_props: input.recurring_props || null,
      distinctive_features: input.distinctive_features || null,
    })
    .eq("id", locationId)
    .select()
    .single();

  if (error) throw error;
  return data as ToonLocation;
}

export async function getLocations(supabase: SupabaseClient): Promise<ToonLocation[]> {
  const { data, error } = await supabase
    .from("toon_locations")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as ToonLocation[];
}

export async function getLocation(supabase: SupabaseClient, locationId: string): Promise<ToonLocation | null> {
  const { data, error } = await supabase.from("toon_locations").select("*").eq("id", locationId).maybeSingle();
  if (error) throw error;
  return data as ToonLocation | null;
}

export async function deleteLocation(supabase: SupabaseClient, locationId: string): Promise<void> {
  const { error } = await supabase.from("toon_locations").delete().eq("id", locationId);
  if (error) throw error;
}
