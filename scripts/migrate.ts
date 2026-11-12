// Creates or updates the account, 옷장, 착용 기록, 일정 판단 수정값 and 추천 세션 tables in the database at DATABASE_URL.
// Run with: npm run db:migrate
import { PostgresDialect } from "kysely";
import pg from "pg";
import { createAccount } from "../lib/account/account.ts";
import { createWardrobe } from "../lib/outfit/wardrobe.ts";
import { createAnalysisStore } from "../lib/outfit/analysis-store.ts";
import { createEventCorrections } from "../lib/outfit/event-corrections.ts";
import { createWearRecords } from "../lib/outfit/wear-records.ts";
import { createRecommendationSessions } from "../lib/outfit/recommendation-sessions.ts";

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
// After the account tables, since clothes, 착용 기록, 일정 판단 수정값 and 추천 세션 belong to a user.
await createWardrobe({ dialect }).migrate();
await createWearRecords({ dialect }).migrate();
await createEventCorrections({ dialect }).migrate();
await createRecommendationSessions({ dialect }).migrate();
await createAnalysisStore({ dialect }).migrate();
await pool.end();
console.log("Account, 옷장, 착용 기록, 일정 판단 수정값 and 추천 세션 tables are up to date.");
