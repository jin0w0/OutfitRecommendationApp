import { PGlite } from "@electric-sql/pglite";
import { Kysely } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";

// Each call gets its own in-memory Postgres, so tests never share data.
export async function createTestDatabase(): Promise<Kysely<any>> {
  const pg = await PGlite.create();
  return new Kysely<any>({ dialect: new PGliteDialect(pg) });
}
