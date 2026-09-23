import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import pg from "pg";
import fs from "node:fs";

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

for (const f of ["010_toon_character_sheets_schema.sql", "011_toon_character_sheets_rls.sql", "012_toon_character_sheets_storage.sql"]) {
  await client.query(fs.readFileSync(`supabase/${f}`, "utf-8"));
  console.log("OK:", f);
}

const bucket = await client.query(`select id, public from storage.buckets where id='toon-character-sheets';`);
console.log("bucket:", bucket.rows);
const policies = await client.query(`select policyname, cmd from pg_policies where tablename in ('toon_character_sheets','objects') and (policyname like '%character_sheet%') order by policyname;`);
console.log("policies:", policies.rows);

await client.end();
