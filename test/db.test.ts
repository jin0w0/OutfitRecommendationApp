import { expect, test } from "vitest";
import { sql } from "kysely";
import { createTestDatabase } from "./db";

test("each test database starts empty", async () => {
  const first = await createTestDatabase();
  await sql`create table note (body text)`.execute(first);
  await sql`insert into note values ('hello')`.execute(first);

  const second = await createTestDatabase();
  const tables = await sql<{ n: number }>`
    select count(*)::int as n from information_schema.tables where table_name = 'note'
  `.execute(second);

  expect(tables.rows[0].n).toBe(0);
});
