import "server-only";
import { nextCookies } from "better-auth/next-js";
import { PostgresDialect } from "kysely";
import { Pool } from "pg";
import { createAccount, type Account } from "./account";

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

let instance: Account | undefined;

// The app's single account module, wired to Neon and the real Google. Built on
// first use so that `next build` does not need the secrets.
export function getAccount(): Account {
  instance ??= createAccount({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: env("DATABASE_URL") }),
    }),
    baseURL: env("BETTER_AUTH_URL"),
    secret: env("BETTER_AUTH_SECRET"),
    google: {
      clientId: env("GOOGLE_CLIENT_ID"),
      clientSecret: env("GOOGLE_CLIENT_SECRET"),
    },
    tokenEncryptionKey: env("TOKEN_ENCRYPTION_KEY"),
    // Imported when needed: the outfit module's own wiring imports this file.
    onCalendarDisconnected: async (userId) => {
      const { getOutfitRecommender } = await import("@/lib/outfit/server");
      await getOutfitRecommender().forgetCalendar(userId);
    },
    // A storage outage must not stop 탈퇴, as with Google revocation.
    onAccountDeleted: async (userId) => {
      const { getCloset } = await import("@/lib/outfit/server");
      await getCloset()
        .removeAllPhotos(userId)
        .catch((error) => console.error("Could not remove the user's clothing photos", error));
    },
    // Lets server actions set and clear the session cookie.
    plugins: [nextCookies()],
  });
  return instance;
}
