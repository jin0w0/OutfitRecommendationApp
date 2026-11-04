// 캘린더 연동 storage and OAuth flow, kept apart from Better Auth so a calendar
// account never becomes a way to sign in (ADR-0002).
import { createHash, randomBytes } from "node:crypto";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { sql, type Kysely } from "kysely";
import {
  CALENDAR_SCOPE,
  calendarAuthorizationURL,
  exchangeCode,
  identityFromIdToken,
  refreshTokens,
  type GoogleClient,
} from "./google-oauth.ts";

type Tables = {
  calendar_connection: {
    user_id: string;
    google_id: string;
    email: string;
    access_token: string;
    refresh_token: string;
    access_token_expires_at: Date;
    status: "connected" | "reconnect-needed";
    updated_at: Date;
  };
  calendar_connection_request: {
    state: string;
    user_id: string;
    code_verifier: string;
    return_to: string;
    expires_at: Date;
  };
};

export type CalendarConnectionSummary = {
  email: string;
  status: "connected" | "reconnect-needed";
};

export type CalendarAccessToken =
  | { status: "ok"; accessToken: string }
  | { status: "not-connected" }
  | { status: "reconnect-needed" };

export type CompletedConnection =
  | { status: "connected"; returnTo: string }
  | { status: "cancelled"; returnTo: string }
  | { status: "failed"; returnTo: string };

const REQUEST_LIFETIME_MS = 10 * 60 * 1000;
// Refresh a little early so a token never expires mid-request.
const EXPIRY_MARGIN_MS = 60 * 1000;

export function createCalendarConnections({
  db,
  google,
  encryptionKey,
}: {
  db: Kysely<Tables>;
  google: GoogleClient;
  encryptionKey: string;
}) {
  const encrypt = (data: string) => symmetricEncrypt({ key: encryptionKey, data });
  const decrypt = (data: string) => symmetricDecrypt({ key: encryptionKey, data });

  return {
    async migrate() {
      await db.schema
        .createTable("calendar_connection")
        .ifNotExists()
        .addColumn("user_id", "text", (c) =>
          c.primaryKey().references("user.id").onDelete("cascade"),
        )
        .addColumn("google_id", "text", (c) => c.notNull())
        .addColumn("email", "text", (c) => c.notNull())
        .addColumn("access_token", "text", (c) => c.notNull())
        .addColumn("refresh_token", "text", (c) => c.notNull())
        .addColumn("access_token_expires_at", "timestamptz", (c) => c.notNull())
        .addColumn("status", "text", (c) => c.notNull())
        .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
        .execute();
      await db.schema
        .createTable("calendar_connection_request")
        .ifNotExists()
        .addColumn("state", "text", (c) => c.primaryKey())
        .addColumn("user_id", "text", (c) =>
          c.notNull().references("user.id").onDelete("cascade"),
        )
        .addColumn("code_verifier", "text", (c) => c.notNull())
        .addColumn("return_to", "text", (c) => c.notNull())
        .addColumn("expires_at", "timestamptz", (c) => c.notNull())
        .execute();
    },

    async start(userId: string, returnTo: string) {
      const state = randomBytes(32).toString("base64url");
      const codeVerifier = randomBytes(32).toString("base64url");
      await db
        .insertInto("calendar_connection_request")
        .values({
          state,
          user_id: userId,
          code_verifier: codeVerifier,
          return_to: returnTo,
          expires_at: new Date(Date.now() + REQUEST_LIFETIME_MS),
        })
        .execute();
      const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
      return calendarAuthorizationURL(google, { state, codeChallenge });
    },

    // `params` are the query parameters Google sent back to the callback.
    async complete(userId: string, params: URLSearchParams): Promise<CompletedConnection> {
      const request = await db
        .deleteFrom("calendar_connection_request")
        .where("state", "=", params.get("state") ?? "")
        .returningAll()
        .executeTakeFirst();
      // A state the user didn't start (or an old one) is never honoured.
      if (!request || request.user_id !== userId || request.expires_at < new Date()) {
        return { status: "failed", returnTo: request?.return_to ?? "/settings" };
      }
      const returnTo = request.return_to;

      if (params.get("error") === "access_denied") return { status: "cancelled", returnTo };
      const code = params.get("code");
      if (!code) return { status: "failed", returnTo };

      const tokens = await exchangeCode(google, { code, codeVerifier: request.code_verifier });
      if (!tokens?.idToken || !tokens.refreshToken || !tokens.scope.includes(CALENDAR_SCOPE)) {
        return { status: "failed", returnTo };
      }

      const { googleId, email } = identityFromIdToken(tokens.idToken);
      const values = {
        google_id: googleId,
        email,
        access_token: await encrypt(tokens.accessToken),
        refresh_token: await encrypt(tokens.refreshToken),
        access_token_expires_at: tokens.expiresAt,
        status: "connected" as const,
        updated_at: new Date(),
      };
      await db
        .insertInto("calendar_connection")
        .values({ user_id: userId, ...values })
        .onConflict((oc) => oc.column("user_id").doUpdateSet(values))
        .execute();
      return { status: "connected", returnTo };
    },

    async summary(userId: string): Promise<CalendarConnectionSummary | null> {
      const row = await db
        .selectFrom("calendar_connection")
        .select(["email", "status"])
        .where("user_id", "=", userId)
        .executeTakeFirst();
      return row ?? null;
    },

    async accessToken(userId: string): Promise<CalendarAccessToken> {
      const row = await db
        .selectFrom("calendar_connection")
        .selectAll()
        .where("user_id", "=", userId)
        .executeTakeFirst();
      if (!row) return { status: "not-connected" };
      if (row.status === "reconnect-needed") return { status: "reconnect-needed" };

      if (row.access_token_expires_at.getTime() - EXPIRY_MARGIN_MS > Date.now()) {
        return { status: "ok", accessToken: await decrypt(row.access_token) };
      }

      const refreshed = await refreshTokens(google, await decrypt(row.refresh_token));
      if (!refreshed) {
        await db
          .updateTable("calendar_connection")
          .set({ status: "reconnect-needed", updated_at: new Date() })
          .where("user_id", "=", userId)
          .execute();
        return { status: "reconnect-needed" };
      }
      await db
        .updateTable("calendar_connection")
        .set({
          access_token: await encrypt(refreshed.accessToken),
          // Google may rotate the refresh token; keep the newest one.
          ...(refreshed.refreshToken && { refresh_token: await encrypt(refreshed.refreshToken) }),
          access_token_expires_at: refreshed.expiresAt,
          updated_at: new Date(),
        })
        .where("user_id", "=", userId)
        .execute();
      return { status: "ok", accessToken: refreshed.accessToken };
    },
  };
}
