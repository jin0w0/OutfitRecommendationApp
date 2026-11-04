import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import type { Dialect } from "kysely";

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
    plugins: config.plugins ?? [],
  } satisfies BetterAuthOptions;

  const auth = betterAuth(options);

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
      return { id, name, email, image: image ?? null };
    },

    async signOut(headers: Headers) {
      await auth.api.signOut({ headers });
    },
  };
}

export type Account = ReturnType<typeof createAccount>;
