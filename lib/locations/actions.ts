"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "../supabase/server";
import { validateLocationForm } from "./formValidation";
import * as locationService from "./service";
import type { ToonLocation } from "../../src/db/types";

export interface LocationActionState {
  ok: boolean;
  errors?: Record<string, string>;
  message?: string;
  location?: ToonLocation;
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/toon/login");
  return { supabase, user };
}

function readLocationForm(formData: FormData) {
  return {
    display_name: String(formData.get("display_name") ?? ""),
    visual_prompt: String(formData.get("visual_prompt") ?? ""),
    wall_and_floor: String(formData.get("wall_and_floor") ?? ""),
    fixed_furniture: String(formData.get("fixed_furniture") ?? ""),
    window_style: String(formData.get("window_style") ?? ""),
    recurring_props: String(formData.get("recurring_props") ?? ""),
    distinctive_features: String(formData.get("distinctive_features") ?? ""),
  };
}

export async function createLocationAction(
  _prev: LocationActionState,
  formData: FormData
): Promise<LocationActionState> {
  const { supabase } = await requireUser();

  const validation = validateLocationForm(readLocationForm(formData));
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }

  await locationService.createLocation(supabase, validation.data);

  revalidatePath("/toon/locations");
  redirect("/toon/locations");
}

export async function updateLocationAction(
  locationId: string,
  _prev: LocationActionState,
  formData: FormData
): Promise<LocationActionState> {
  const { supabase } = await requireUser();

  const validation = validateLocationForm(readLocationForm(formData));
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }

  await locationService.updateLocation(supabase, locationId, validation.data);

  revalidatePath(`/toon/locations/${locationId}`);
  revalidatePath("/toon/locations");
  return { ok: true };
}

export async function deleteLocationAction(locationId: string): Promise<{ ok: boolean; message?: string }> {
  const { supabase } = await requireUser();

  try {
    await locationService.deleteLocation(supabase, locationId);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "장소 삭제에 실패했습니다." };
  }

  revalidatePath("/toon/locations");
  return { ok: true };
}
