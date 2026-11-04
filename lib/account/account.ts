import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import type { Dialect } from "kysely";
// Explicit extensions so scripts/migrate.ts can load this file with plain Node.
import { findRegion, type Region } from "./regions.ts";

export type AccountConfig = {
  dialect: Dialect;
  baseURL: string;
  secret: string;
  google: { clientId: string; clientSecret: string };
  plugins?: BetterAuthPlugin[];
};

const DAY = 60 * 60 * 24;

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  homeRegion: Region | null;
  needsOnboarding: boolean;
};

export function createAccount(config: AccountConfig) {
  const options = {
    baseURL: config.baseURL,
    secret: config.secret,
    database: { dialect: config.dialect, type: "postgres" },
    socialProviders: {
      google: {
        clientId: config.google.clientId,
        clientSecret: config.google.clientSecret,
      },
    },
    // "직접 로그아웃할 때까지 유지": a long session that slides forward
    // whenever it is used.
    session: { expiresIn: 365 * DAY, updateAge: DAY },
    user: {
      additionalFields: {
        // Set only through setHomeRegion, never from client input.
        homeRegion: { type: "string", required: false, input: false },
      },
    },
    plugins: config.plugins ?? [],
  } satisfies BetterAuthOptions;

  const auth = betterAuth(options);

  async function requireSession(headers: Headers) {
    const session = await auth.api.getSession({ headers });
    if (!session) throw new Error("Not signed in");
    return session;
  }

  return {
    handler: (request: Request) => auth.handler(request),

    async migrate() {
      const { runMigrations } = await getMigrations(options);
      await runMigrations();
    },

    async getCurrentUser(headers: Headers): Promise<CurrentUser | null> {
      const session = await auth.api.getSession({ headers });
      if (!session) return null;
      const { id, name, email, image } = session.user;
      const homeRegion = findRegion(session.user.homeRegion);
      return {
        id,
        name,
        email,
        image: image ?? null,
        homeRegion,
        needsOnboarding: homeRegion === null,
      };
    },

    async setHomeRegion(headers: Headers, regionId: string) {
      const region = findRegion(regionId);
      if (!region) throw new Error(`Unknown region ${regionId}`);
      const { user } = await requireSession(headers);
      const context = await auth.$context;
      await context.internalAdapter.updateUser(user.id, { homeRegion: region.id });
    },

    async signOut(headers: Headers) {
      await auth.api.signOut({ headers });
    },

    // Other devices first, then this one, so this device's cookie is cleared too.
    async signOutEverywhere(headers: Headers) {
      await auth.api.revokeOtherSessions({ headers });
      await auth.api.signOut({ headers });
    },
  };
}

export type Account = ReturnType<typeof createAccount>;
