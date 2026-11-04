// Creates or updates the account tables in the database at DATABASE_URL.
// Run with: npm run db:migrate
import { PostgresDialect } from "kysely";
import pg from "pg";
import { createAccount } from "../lib/account/account.ts";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const account = createAccount({
  dialect: new PostgresDialect({ pool }),
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET ?? "",
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  },
});

await account.migrate();
await pool.end();
console.log("Account tables are up to date.");
