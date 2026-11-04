import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { Kysely, type Dialect } from "kysely";
// Explicit extensions so scripts/migrate.ts can load this file with plain Node.
import {
  createCalendarConnections,
  type CalendarConnectionSummary,
} from "./calendar-connection.ts";
import { revokeToken } from "./google-oauth.ts";
import { findRegion, type Region } from "./regions.ts";

export type AccountConfig = {
  dialect: Dialect;
  baseURL: string;
  secret: string;
  google: { clientId: string; clientSecret: string };
  // Encrypts the 캘린더 연동 tokens at rest.
  tokenEncryptionKey: string;
  // Lets other features clear data tied to a 캘린더 연동 when it goes away.
  onCalendarDisconnected?: (userId: string) => Promise<void>;
  // Lets other features delete their data for a user who 탈퇴s.
  onAccountDeleted?: (userId: string) => Promise<void>;
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
  calendarConnection: CalendarConnectionSummary | null;
  // Onboarding's one-time 캘린더 연동 권유 is still pending.
  shouldInviteCalendar: boolean;
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
        calendarInviteSeen: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false,
        },
      },
    },
    plugins: config.plugins ?? [],
  } satisfies BetterAuthOptions;

  const auth = betterAuth(options);
  const calendar = createCalendarConnections({
    db: new Kysely({ dialect: config.dialect }),
    google: {
      clientId: config.google.clientId,
      clientSecret: config.google.clientSecret,
      redirectURI: `${config.baseURL}/api/calendar/callback`,
    },
    encryptionKey: config.tokenEncryptionKey,
    onDisconnected: config.onCalendarDisconnected ?? (async () => {}),
  });

  async function markCalendarInviteSeen(userId: string) {
    const context = await auth.$context;
    await context.internalAdapter.updateUser(userId, { calendarInviteSeen: true });
  }

  async function revokeLoginAccess(userId: string, accountId: string) {
    try {
      const { accessToken } = await auth.api.getAccessToken({
        body: { accountId, userId },
      });
      if (accessToken) await revokeToken(accessToken);
    } catch (error) {
      console.error("Could not revoke Google sign-in access", error);
    }
  }

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
      await calendar.migrate();
    },

    async getCurrentUser(headers: Headers): Promise<CurrentUser | null> {
      const session = await auth.api.getSession({ headers });
      if (!session) return null;
      const { id, name, email, image } = session.user;
      const homeRegion = findRegion(session.user.homeRegion);
      const calendarConnection = await calendar.summary(id);
      return {
        id,
        name,
        email,
        image: image ?? null,
        homeRegion,
        needsOnboarding: homeRegion === null,
        calendarConnection,
        shouldInviteCalendar:
          homeRegion !== null && !session.user.calendarInviteSeen && calendarConnection === null,
      };
    },

    async setHomeRegion(headers: Headers, regionId: string) {
      const region = findRegion(regionId);
      if (!region) throw new Error(`Unknown region ${regionId}`);
      const { user } = await requireSession(headers);
      const context = await auth.$context;
      await context.internalAdapter.updateUser(user.id, { homeRegion: region.id });
    },

    // Returns the Google consent URL to send the browser to. `returnTo` is
    // where the callback lands afterwards.
    async startCalendarConnection(headers: Headers, returnTo: string) {
      const { user } = await requireSession(headers);
      await markCalendarInviteSeen(user.id);
      return calendar.start(user.id, returnTo);
    },

    async dismissCalendarInvite(headers: Headers) {
      const { user } = await requireSession(headers);
      await markCalendarInviteSeen(user.id);
    },

    async completeCalendarConnection(headers: Headers, callbackParams: URLSearchParams) {
      const { user } = await requireSession(headers);
      return calendar.complete(user.id, callbackParams);
    },

    async listCalendars(headers: Headers) {
      const { user } = await requireSession(headers);
      return calendar.listCalendars(user.id);
    },

    async selectCalendars(headers: Headers, calendarIds: string[]) {
      const { user } = await requireSession(headers);
      await calendar.selectCalendars(user.id, calendarIds);
    },

    async disconnectCalendar(headers: Headers) {
      const { user } = await requireSession(headers);
      await calendar.disconnect(user.id);
    },

    // 탈퇴: revoke Google access, let other features delete their data, then
    // remove the user with every session and sign-in link. Revocation failures
    // never stop the deletion.
    async deleteAccount(headers: Headers) {
      const { user } = await requireSession(headers);
      const context = await auth.$context;

      await calendar.disconnect(user.id);
      for (const login of await context.internalAdapter.findAccounts(user.id)) {
        if (await calendar.connectedByOthers(login.accountId, user.id)) continue;
        await revokeLoginAccess(user.id, login.id);
      }
      await config.onAccountDeleted?.(user.id);

      await auth.api.signOut({ headers });
      await context.internalAdapter.deleteUserSessions(user.id);
      await context.internalAdapter.deleteAccounts(user.id);
      await context.internalAdapter.deleteUser(user.id);
    },

    // For server-side callers (the calendar adapter) that already know the user.
    getCalendarAccessToken: (userId: string) => calendar.accessToken(userId),
    getSelectedCalendarIds: (userId: string) => calendar.selectedCalendarIds(userId),

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
