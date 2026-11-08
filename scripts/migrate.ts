// Creates or updates the account, 옷장 and 착용 기록 tables in the database at DATABASE_URL.
// Run with: npm run db:migrate
import { PostgresDialect } from "kysely";
import pg from "pg";
import { createAccount } from "../lib/account/account.ts";
import { createWardrobe } from "../lib/outfit/wardrobe.ts";
import { createWearRecords } from "../lib/outfit/wear-records.ts";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const dialect = new PostgresDialect({ pool });
const account = createAccount({
  dialect,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET ?? "",
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  },
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? "",
});

await account.migrate();
// After the account tables, since clothes and 착용 기록 belong to a user.
await createWardrobe({ dialect }).migrate();
await createWearRecords({ dialect }).migrate();
await pool.end();
console.log("Account, 옷장 and 착용 기록 tables are up to date.");
