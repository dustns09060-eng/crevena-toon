import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";
import path from "node:path";

const SUPABASE_DIR = path.resolve(__dirname, "../../supabase");

const MIGRATION_FILES = [
  "001_toon_schema.sql",
  "002_toon_rls.sql",
  "003_toon_indexes.sql",
  "004_toon_panel_count_guard.sql",
  "005_toon_dialogue_shape_guard.sql",
  "006_toon_user_defaults.sql",
  // 007/008/012는 Supabase 내장 storage 스키마(storage.buckets/objects)에
  // 의존하므로 PGlite 스텁 환경에서는 재현하지 않는다 (STEP 1.6 보고서 참조).
  "009_toon_character_bible_fields.sql",
  "010_toon_character_sheets_schema.sql",
  "011_toon_character_sheets_rls.sql",
  "013_toon_projects_storyboard_status.sql",
  "014_toon_panels_character_ids.sql",
  "015_toon_panel_images_schema.sql",
  "016_toon_panel_images_rls.sql",
  // 017(storage)은 Supabase 내장 storage 스키마에 의존하므로 PGlite에서 제외.
];

function readSql(file: string): string {
  return fs.readFileSync(path.join(SUPABASE_DIR, file), "utf-8");
}

/**
 * Supabase 프로젝트가 기본 제공하는 것 중 이 테스트에 필요한 최소한만
 * 흉내 낸 스텁이다: `auth` 스키마, `auth.users`, `auth.uid()`,
 * `authenticated` role. 실제 Supabase의 auth.uid() 구현과 동일하게
 * `request.jwt.claim.sub` 세션 설정값을 읽는 방식으로 만들었다.
 *
 * supabase/001~005 SQL 파일 자체는 이 스텁에 의존하지 않는다 — 실제
 * Supabase 프로젝트에는 이미 auth 스키마가 존재하므로, 배포용
 * 마이그레이션 파일에 스텁을 포함시키지 않았다.
 */
async function installSupabaseStub(db: PGlite) {
  await db.exec(`
    create schema if not exists auth;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text
    );
    create or replace function auth.uid() returns uuid
    language sql stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
  `);
}

async function installAuthenticatedRole(db: PGlite) {
  await db.exec(`
    create role authenticated nologin;
    grant usage on schema public to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `);
}

export interface TestDb {
  db: PGlite;
  createUser(email: string): Promise<string>;
  /** 이후 쿼리를 해당 사용자로 로그인한 것처럼(RLS 적용) 실행한다. */
  actAs(userId: string): Promise<void>;
  /** table owner(RLS 우회 가능한 관리자) 컨텍스트로 되돌린다. */
  actAsOwner(): Promise<void>;
  close(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const db = new PGlite({ extensions: { pgcrypto } });

  await db.exec(`create extension if not exists pgcrypto;`);
  await installSupabaseStub(db);

  for (const file of MIGRATION_FILES) {
    try {
      await db.exec(readSql(file));
    } catch (err) {
      throw new Error(`마이그레이션 실행 실패: ${file}\n${(err as Error).message}`);
    }
  }

  await installAuthenticatedRole(db);

  return {
    db,
    async createUser(email: string) {
      const result = await db.query<{ id: string }>(
        `insert into auth.users (email) values ($1) returning id;`,
        [email]
      );
      return result.rows[0].id;
    },
    async actAs(userId: string) {
      await db.exec(`set role authenticated;`);
      await db.query(`select set_config('request.jwt.claim.sub', $1, false);`, [userId]);
    },
    async actAsOwner() {
      await db.exec(`reset role;`);
      await db.exec(`select set_config('request.jwt.claim.sub', '', false);`);
    },
    async close() {
      await db.close();
    },
  };
}
