import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestDb, type TestDb } from "./harness.js";

let tdb: TestDb;

beforeAll(async () => {
  tdb = await createTestDb();
});

afterAll(async () => {
  await tdb.close();
});

const EXPECTED_TABLES = [
  "toon_characters",
  "toon_character_references",
  "toon_projects",
  "toon_project_characters",
  "toon_panels",
  "toon_captions",
  "toon_generations",
];

describe("001~005 마이그레이션 스키마", () => {
  test("필수 테이블이 모두 생성된다", async () => {
    const { rows } = await tdb.db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' and table_name like 'toon_%' order by table_name;`
    );
    const names = rows.map((r) => r.table_name);
    for (const t of EXPECTED_TABLES) {
      expect(names).toContain(t);
    }
  });

  test("모든 toon_ 테이블에 RLS가 켜져 있다", async () => {
    const { rows } = await tdb.db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class where relname like 'toon_%' and relkind = 'r' order by relname;`
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.relrowsecurity, `${r.relname}에 RLS가 꺼져 있음`).toBe(true);
    }
  });

  test("toon_projects.panel_count는 6/8/10만 허용한다", async () => {
    const userId = await tdb.createUser("panelcount@test.local");
    await tdb.actAsOwner();

    for (const count of [6, 8, 10]) {
      await expect(
        tdb.db.query(
          `insert into toon_projects (user_id, title, panel_count) values ($1, $2, $3);`,
          [userId, `ok-${count}`, count]
        )
      ).resolves.toBeDefined();
    }

    for (const count of [1, 5, 7, 9, 11, 12]) {
      await expect(
        tdb.db.query(
          `insert into toon_projects (user_id, title, panel_count) values ($1, $2, $3);`,
          [userId, `bad-${count}`, count]
        )
      ).rejects.toThrow();
    }
  });

  test("panel_number는 project의 panel_count를 초과할 수 없다 (INSERT 시점 방어)", async () => {
    const userId = await tdb.createUser("panelnumber@test.local");
    await tdb.actAsOwner();

    const proj = await tdb.db.query<{ id: string }>(
      `insert into toon_projects (user_id, title, panel_count) values ($1, 'panel-number-test', 6) returning id;`,
      [userId]
    );
    const projectId = proj.rows[0].id;

    for (const n of [1, 6]) {
      await expect(
        tdb.db.query(
          `insert into toon_panels (project_id, panel_number) values ($1, $2);`,
          [projectId, n]
        )
      ).resolves.toBeDefined();
    }

    for (const n of [0, 7, 20]) {
      await expect(
        tdb.db.query(
          `insert into toon_panels (project_id, panel_number) values ($1, $2);`,
          [projectId, n]
        )
      ).rejects.toThrow();
    }
  });

  test("panel_count를 줄여서 기존 panel_number보다 작아지면 거부된다", async () => {
    const userId = await tdb.createUser("shrink@test.local");
    await tdb.actAsOwner();

    const proj = await tdb.db.query<{ id: string }>(
      `insert into toon_projects (user_id, title, panel_count) values ($1, 'shrink-test', 10) returning id;`,
      [userId]
    );
    const projectId = proj.rows[0].id;

    await tdb.db.query(`insert into toon_panels (project_id, panel_number) values ($1, 10);`, [
      projectId,
    ]);

    // panel 10이 존재하는 상태에서 panel_count를 6으로 줄이면 거부돼야 한다
    await expect(
      tdb.db.query(`update toon_projects set panel_count = 6 where id = $1;`, [projectId])
    ).rejects.toThrow();

    // panel 10을 지우면 이제는 줄일 수 있어야 한다
    await tdb.db.query(`delete from toon_panels where project_id = $1 and panel_number = 10;`, [
      projectId,
    ]);
    await expect(
      tdb.db.query(`update toon_projects set panel_count = 6 where id = $1;`, [projectId])
    ).resolves.toBeDefined();
  });

  test("toon_project_characters는 (project_id, character_id) 중복을 허용하지 않는다", async () => {
    const userId = await tdb.createUser("dupe-link@test.local");
    await tdb.actAsOwner();

    const proj = await tdb.db.query<{ id: string }>(
      `insert into toon_projects (user_id, title, panel_count) values ($1, 'dupe-link', 6) returning id;`,
      [userId]
    );
    const char = await tdb.db.query<{ id: string }>(
      `insert into toon_characters (user_id, display_name, visual_prompt) values ($1, '엄마', 'test prompt') returning id;`,
      [userId]
    );
    const projectId = proj.rows[0].id;
    const characterId = char.rows[0].id;

    await tdb.db.query(
      `insert into toon_project_characters (project_id, character_id) values ($1, $2);`,
      [projectId, characterId]
    );

    await expect(
      tdb.db.query(
        `insert into toon_project_characters (project_id, character_id) values ($1, $2);`,
        [projectId, characterId]
      )
    ).rejects.toThrow();
  });

  test("toon_character_references는 캐릭터당 is_primary=true를 1개만 허용한다", async () => {
    const userId = await tdb.createUser("primary-ref@test.local");
    await tdb.actAsOwner();

    const char = await tdb.db.query<{ id: string }>(
      `insert into toon_characters (user_id, display_name, visual_prompt) values ($1, '첫째', 'test prompt') returning id;`,
      [userId]
    );
    const characterId = char.rows[0].id;

    await tdb.db.query(
      `insert into toon_character_references (character_id, variant, storage_path, is_primary) values ($1, 'original', 'a.jpg', true);`,
      [characterId]
    );

    await expect(
      tdb.db.query(
        `insert into toon_character_references (character_id, variant, storage_path, is_primary) values ($1, 'crop', 'b.jpg', true);`,
        [characterId]
      )
    ).rejects.toThrow();

    // primary가 아닌 참조는 여러 개 허용돼야 한다
    await expect(
      tdb.db.query(
        `insert into toon_character_references (character_id, variant, storage_path, is_primary) values ($1, 'background_removed', 'c.jpg', false);`,
        [characterId]
      )
    ).resolves.toBeDefined();
  });

  test("toon_panels.dialogue는 JSON 배열이어야 한다", async () => {
    const userId = await tdb.createUser("dialogue-shape@test.local");
    await tdb.actAsOwner();

    const proj = await tdb.db.query<{ id: string }>(
      `insert into toon_projects (user_id, title, panel_count) values ($1, 'dialogue-shape', 6) returning id;`,
      [userId]
    );
    const projectId = proj.rows[0].id;

    await expect(
      tdb.db.query(
        `insert into toon_panels (project_id, panel_number, dialogue) values ($1, 1, '[]'::jsonb);`,
        [projectId]
      )
    ).resolves.toBeDefined();

    await expect(
      tdb.db.query(
        `insert into toon_panels (project_id, panel_number, dialogue) values ($1, 2, '{}'::jsonb);`,
        [projectId]
      )
    ).rejects.toThrow();
  });
});
