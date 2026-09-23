import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestDb, type TestDb } from "./harness.js";

let tdb: TestDb;
let userA: string;
let userB: string;

let projectA: string;
let characterA: string;
let characterB: string;
let panelA: string;

beforeAll(async () => {
  tdb = await createTestDb();
  userA = await tdb.createUser("user-a@test.local");
  userB = await tdb.createUser("user-b@test.local");

  // USER_A로 기준 데이터 생성
  await tdb.actAs(userA);
  const proj = await tdb.db.query<{ id: string }>(
    `insert into toon_projects (user_id, title, panel_count) values (auth.uid(), 'A의 프로젝트', 6) returning id;`
  );
  projectA = proj.rows[0].id;

  const char = await tdb.db.query<{ id: string }>(
    `insert into toon_characters (user_id, display_name, visual_prompt) values (auth.uid(), 'A의 캐릭터', 'p') returning id;`
  );
  characterA = char.rows[0].id;

  const panel = await tdb.db.query<{ id: string }>(
    `insert into toon_panels (project_id, panel_number) values ($1, 1) returning id;`,
    [projectA]
  );
  panelA = panel.rows[0].id;

  await tdb.db.query(`insert into toon_captions (project_id, caption) values ($1, 'A의 캡션');`, [
    projectA,
  ]);

  // USER_B의 캐릭터 (본인 소유, RLS 정상 동작 확인용)
  await tdb.actAs(userB);
  const charB = await tdb.db.query<{ id: string }>(
    `insert into toon_characters (user_id, display_name, visual_prompt) values (auth.uid(), 'B의 캐릭터', 'p') returning id;`
  );
  characterB = charB.rows[0].id;
});

afterAll(async () => {
  await tdb.close();
});

describe("RLS 격리: USER_A vs USER_B", () => {
  test("[양성 대조군] USER_A는 자신의 프로젝트를 SELECT할 수 있다", async () => {
    await tdb.actAs(userA);
    const { rows } = await tdb.db.query(`select id from toon_projects where id = $1;`, [
      projectA,
    ]);
    expect(rows.length).toBe(1);
  });

  test("USER_B는 USER_A의 캐릭터를 SELECT할 수 없다", async () => {
    await tdb.actAs(userB);
    const { rows } = await tdb.db.query(`select id from toon_characters where id = $1;`, [
      characterA,
    ]);
    expect(rows.length).toBe(0);
  });

  test("USER_B는 USER_A의 프로젝트를 SELECT할 수 없다", async () => {
    await tdb.actAs(userB);
    const { rows } = await tdb.db.query(`select id from toon_projects where id = $1;`, [
      projectA,
    ]);
    expect(rows.length).toBe(0);
  });

  test("USER_B는 자신의 캐릭터를 USER_A의 프로젝트에 연결할 수 없다", async () => {
    await tdb.actAs(userB);
    await expect(
      tdb.db.query(
        `insert into toon_project_characters (project_id, character_id) values ($1, $2);`,
        [projectA, characterB]
      )
    ).rejects.toThrow();
  });

  test("USER_B는 USER_A의 캐릭터를 자신의 (가상) 프로젝트에도 연결할 수 없다 (프로젝트 조건에서 이미 차단)", async () => {
    await tdb.actAs(userB);
    // USER_B 소유 프로젝트가 없는 상태에서 시도 — project 소유권 체크에서 이미 막혀야 한다.
    await expect(
      tdb.db.query(
        `insert into toon_project_characters (project_id, character_id) values ($1, $2);`,
        [projectA, characterA]
      )
    ).rejects.toThrow();
  });

  test("USER_B는 USER_A의 project_id로 panel을 INSERT할 수 없다", async () => {
    await tdb.actAs(userB);
    await expect(
      tdb.db.query(`insert into toon_panels (project_id, panel_number) values ($1, 2);`, [
        projectA,
      ])
    ).rejects.toThrow();
  });

  test("USER_B는 USER_A의 panel을 UPDATE/DELETE할 수 없다", async () => {
    await tdb.actAs(userB);

    const upd = await tdb.db.query(`update toon_panels set scene = 'hacked' where id = $1;`, [
      panelA,
    ]);
    expect(upd.affectedRows ?? 0).toBe(0);

    const del = await tdb.db.query(`delete from toon_panels where id = $1;`, [panelA]);
    expect(del.affectedRows ?? 0).toBe(0);
  });

  test("USER_B는 USER_A의 project_id로 caption을 INSERT할 수 없다", async () => {
    await tdb.actAs(userB);
    await expect(
      tdb.db.query(`insert into toon_captions (project_id, caption) values ($1, '가로채기');`, [
        projectA,
      ])
    ).rejects.toThrow();
  });

  test("USER_B는 USER_A의 project/panel을 이용해 generation log를 INSERT할 수 없다", async () => {
    await tdb.actAs(userB);
    await expect(
      tdb.db.query(
        `insert into toon_generations (user_id, project_id, generation_type, provider, model)
         values (auth.uid(), $1, 'panel_image', 'gemini', 'gemini-2.5-flash-image');`,
        [projectA]
      )
    ).rejects.toThrow();

    await expect(
      tdb.db.query(
        `insert into toon_generations (user_id, panel_id, generation_type, provider, model)
         values (auth.uid(), $1, 'panel_image', 'gemini', 'gemini-2.5-flash-image');`,
        [panelA]
      )
    ).rejects.toThrow();
  });

  test("USER_B는 자신을 다른 user_id인 것처럼 위장해 generation log를 남길 수 없다", async () => {
    await tdb.actAs(userB);
    await expect(
      tdb.db.query(
        `insert into toon_generations (user_id, generation_type, provider, model)
         values ($1, 'topic', 'gemini', 'gemini-2.5-flash-image');`,
        [userA]
      )
    ).rejects.toThrow();
  });
});

describe("toon_generations 클라이언트 보호", () => {
  let generationId: string;

  beforeAll(async () => {
    await tdb.actAs(userA);
    const gen = await tdb.db.query<{ id: string }>(
      `insert into toon_generations (user_id, project_id, generation_type, provider, model)
       values (auth.uid(), $1, 'panel_image', 'gemini', 'gemini-2.5-flash-image')
       returning id;`,
      [projectA]
    );
    generationId = gen.rows[0].id;
  });

  test("USER_A(작성자 본인)도 클라이언트 권한으로는 자기 generation log를 UPDATE할 수 없다", async () => {
    await tdb.actAs(userA);
    const upd = await tdb.db.query(`update toon_generations set status = 'refunded' where id = $1;`, [
      generationId,
    ]);
    expect(upd.affectedRows ?? 0).toBe(0);
  });

  test("USER_A도 클라이언트 권한으로는 자기 generation log를 DELETE할 수 없다", async () => {
    await tdb.actAs(userA);
    const del = await tdb.db.query(`delete from toon_generations where id = $1;`, [generationId]);
    expect(del.affectedRows ?? 0).toBe(0);
  });

  test("USER_A는 자신의 generation log를 SELECT할 수 있다", async () => {
    await tdb.actAs(userA);
    const { rows } = await tdb.db.query<{ id: string; status: string }>(
      `select id, status from toon_generations where id = $1;`,
      [generationId]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("pending"); // UPDATE가 실제로 막혔는지 재확인
  });

  test("USER_B는 USER_A의 generation log를 SELECT할 수 없다", async () => {
    await tdb.actAs(userB);
    const { rows } = await tdb.db.query(`select id from toon_generations where id = $1;`, [
      generationId,
    ]);
    expect(rows.length).toBe(0);
  });
});

describe("toon_character_references RLS", () => {
  test("USER_B는 USER_A의 캐릭터에 reference를 추가할 수 없다", async () => {
    await tdb.actAs(userB);
    await expect(
      tdb.db.query(
        `insert into toon_character_references (character_id, variant, storage_path, is_primary) values ($1, 'original', 'hijack.jpg', true);`,
        [characterA]
      )
    ).rejects.toThrow();
  });

  test("USER_B는 USER_A 캐릭터의 reference를 SELECT할 수 없다", async () => {
    await tdb.actAs(userA);
    await tdb.db.query(
      `insert into toon_character_references (character_id, variant, storage_path, is_primary) values ($1, 'original', 'a.jpg', true);`,
      [characterA]
    );

    await tdb.actAs(userB);
    const { rows } = await tdb.db.query(
      `select id from toon_character_references where character_id = $1;`,
      [characterA]
    );
    expect(rows.length).toBe(0);
  });
});

describe("006: user_id DEFAULT auth.uid()", () => {
  test("USER_A가 user_id 없이 자신의 character를 생성하면 auth.uid()가 자동 입력된다", async () => {
    await tdb.actAs(userA);
    const { rows } = await tdb.db.query<{ id: string; user_id: string }>(
      `insert into toon_characters (display_name, visual_prompt) values ('디폴트 테스트', 'p') returning id, user_id;`
    );
    expect(rows[0].user_id).toBe(userA);
  });

  test("USER_A가 USER_B의 user_id를 명시해서 생성하면 여전히 거부된다", async () => {
    await tdb.actAs(userA);
    await expect(
      tdb.db.query(
        `insert into toon_characters (user_id, display_name, visual_prompt) values ($1, '위장 시도', 'p');`,
        [userB]
      )
    ).rejects.toThrow();
  });

  test("로그인하지 않은(auth.uid()가 NULL인) 요청은 여전히 차단된다", async () => {
    await tdb.actAs(userA);
    await tdb.actAsOwner(); // request.jwt.claim.sub를 비움 = 비로그인 상태
    await tdb.db.exec(`set role authenticated;`); // 여전히 authenticated role로만 시도 (RLS 대상)
    await expect(
      tdb.db.query(`insert into toon_characters (display_name, visual_prompt) values ('익명 시도', 'p');`)
    ).rejects.toThrow();
    await tdb.db.exec(`reset role;`);
  });
});
