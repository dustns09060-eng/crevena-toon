import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import "dotenv/config";
import pg from "pg";
import fs from "node:fs";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OUT_DIR = "D:/주식알림톡/.pip-tmp/claude/D------/86d24d53-dffc-4d12-a056-07578ed3cecd/scratchpad/step4-consistency-check";

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
const charRes = await client.query(`select * from toon_characters where id='17f552d4-7ac6-4a47-8113-c4660b0edc55';`);
const character = charRes.rows[0];
const sheetRes = await client.query(`select storage_path from toon_character_sheets where character_id=$1 and status='approved';`, [character.id]);
const sheetPath = sheetRes.rows[0].storage_path;
await client.end();

async function downloadStorage(bucket, path) {
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!res.ok) throw new Error(`download failed ${res.status}: ${await res.text()}`);
  return new Uint8Array(await res.arrayBuffer());
}

const sheetBytes = await downloadStorage("toon-character-sheets", sheetPath);
const refBytes = fs.readFileSync("references/mom.jpg");

fs.writeFileSync(`${OUT_DIR}/approved-sheet.png`, sheetBytes);
console.log("saved approved sheet locally for inspection");

const { generateImageFromPrompt } = await import("./src/providers/gemini.ts");
const { buildCharacterSheetPrompt } = await import("./src/providers/characterSheetPromptBuilder.ts");
// scene용 별도 프롬프트 빌더 (STEP0 buildScenePrompt와 유사하지만 DB bible 사용)

const bible = {
  hairstyle: character.hairstyle,
  hair_color: character.hair_color,
  face_features: character.face_features,
  body_type: character.body_type,
  representative_outfit: character.representative_outfit,
  distinctive_features: character.distinctive_features,
  visual_prompt: character.visual_prompt,
  negative_constraints: character.negative_constraints,
};

function buildScenePromptForConsistencyTest(scene) {
  return [
    "Draw a single Instagram-style illustration panel (1:1) of the SAME character shown in the attached character sheet and reference photo.",
    `Hairstyle: ${bible.hairstyle}`,
    `Hair color: ${bible.hair_color}`,
    `Face features: ${bible.face_features}`,
    `Body type: ${bible.body_type}`,
    `Representative outfit: ${bible.representative_outfit}`,
    bible.visual_prompt,
    `Scene: ${scene}`,
    "Use the attached character sheet as the primary reference for facial identity, hairstyle, hair color and outfit consistency. Do not copy the character sheet's plain grid background — draw a new scene-appropriate background for this panel instead.",
    "Do not copy the background or props from the reference photo.",
    "Rules: same character as reference, consistent facial features, consistent hairstyle, consistent hair color, consistent outfit, no speech bubbles, no Korean text, no text labels, no watermark.",
    "Character-specific constraints: " + bible.negative_constraints.join("; ") + ".",
  ].join("\n");
}

const scenes = [
  { id: "A", desc: "거실 소파에 앉아 커피잔을 들고 활짝 웃는 장면, 낮의 밝은 실내." },
  { id: "B", desc: "공원 벤치 근처에서 눈을 크게 뜨고 놀란 표정을 짓는 장면, 나무와 잔디가 보이는 야외." },
  { id: "C", desc: "식탁 의자에 앉아 휴대폰 화면을 바라보는 장면, 부엌 배경." },
];

for (const scene of scenes) {
  const prompt = buildScenePromptForConsistencyTest(scene.desc);
  console.log(`\n=== Scene ${scene.id} ===`);
  const bytes = await generateImageFromPrompt(prompt, [
    { bytes: sheetBytes, mimeType: "image/png" },
    { bytes: refBytes, mimeType: "image/jpeg" },
  ]);
  fs.writeFileSync(`${OUT_DIR}/scene-${scene.id}.png`, bytes);
  console.log(`saved scene-${scene.id}.png, bytes=${bytes.length}`);
}
console.log("\nALL DONE — local files only, not saved to Storage/DB project data.");
