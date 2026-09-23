export interface CharacterBible {
  character_id: string;
  display_name: string;
  role: string;
  age_group: string;
  hairstyle: string;
  hair_color: string;
  face_features: string;
  body_type: string;
  representative_outfit: string;
  personality: string;
  speaking_style: string;
  visual_prompt: string;
  negative_constraints: string;
  reference_images: string[];
}

export interface SceneDefinition {
  scene_id: string;
  title_ko: string;
  character_ids: string[];
  prompt: string;
}

export type ProviderId = "gemini" | "openai";

export interface GenerationResult {
  provider: ProviderId;
  scene_id: string;
  success: boolean;
  output_path?: string;
  duration_ms: number;
  estimated_cost_usd?: number;
  error?: string;
}
