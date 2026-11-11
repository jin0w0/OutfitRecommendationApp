// Stands in for Google's OAuth and Calendar HTTP endpoints, so tests run the
// real Better Auth sign-in and linking flows without the network.

export type FakeCalendar = { id: string; summary: string; primary?: boolean };

export type GoogleProfile = {
  email: string;
  name: string;
  picture?: string;
  // Defaults to a single primary calendar named after the account.
  calendars?: FakeCalendar[];
};

type GoogleAccount = GoogleProfile & { sub: string; calendars: FakeCalendar[] };

type Grant = {
  account: GoogleAccount;
  scope: string;
  // Google issues a refresh token only when offline access was requested.
  refreshToken: string | null;
  revoked: boolean;
};

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const CALENDAR_LIST_ENDPOINT = "https://www.googleapis.com/calendar/v3/users/me/calendarList";

export class FakeGoogle {
  private accounts = new Map<string, GoogleAccount>();
  private pendingCodes = new Map<string, { account: GoogleAccount; scope: string; offline: boolean }>();
  private grants = new Set<Grant>();
  private accessTokens = new Map<string, Grant>();
  private counter = 0;
  private revocationsFail = false;
  private down = new Set<string>();

  addAccount(profile: GoogleProfile) {
    const account = {
      ...profile,
      sub: `google-${++this.counter}`,
      calendars: profile.calendars ?? [{ id: profile.email, summary: profile.name, primary: true }],
    };
    this.accounts.set(profile.email, account);
    return account;
  }

  // What the consent screen does: the user picks an account and approves the
  // scopes in the authorization URL, and Google hands back a code.
  approve(authorizationURL: string, email: string) {
    const account = this.accounts.get(email);
    if (!account) throw new Error(`No fake Google account for ${email}`);
    const params = new URL(authorizationURL).searchParams;
    const code = `code-${++this.counter}`;
    this.pendingCodes.set(code, {
      account,
      scope: params.get("scope") ?? "",
      offline: params.get("access_type") === "offline",
    });
    return code;
  }

  // The user removes the app from their Google account settings (or, in
  // Testing mode, the 7-day refresh-token lifetime runs out).
  revokeAccessFromGoogle(email: string) {
    for (const grant of this.grants) {
      if (grant.account.email === email) grant.revoked = true;
    }
  }

  // Whether the account still has a live grant for this app.
  isAppAuthorized(email: string) {
    return [...this.grants].some((g) => g.account.email === email && !g.revoked);
  }

  failRevocations() {
    this.revocationsFail = true;
  }

  // Google has an outage on one endpoint: it answers 503 from now on.
  failTokenEndpoint() {
    this.down.add(TOKEN_ENDPOINT);
  }

  failCalendarList() {
    this.down.add(CALENDAR_LIST_ENDPOINT);
  }

  // Which Google account an access token was issued for, or null if unknown.
  ownerOfAccessToken(accessToken: string) {
    return this.accessTokens.get(accessToken)?.account.email ?? null;
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    if (this.down.has(request.url)) return new Response("unavailable", { status: 503 });
    if (request.url === TOKEN_ENDPOINT) return this.token(request);
    if (request.url === CALENDAR_LIST_ENDPOINT) return this.calendarList(request);
    if (request.url === REVOKE_ENDPOINT) return this.revoke(request);
    throw new Error(`FakeGoogle: unexpected request to ${request.url}`);
  };

  private async token(request: Request) {
    const body = new URLSearchParams(await request.text());
    if (body.get("grant_type") === "refresh_token") {
      const grant = this.grantForRefreshToken(body.get("refresh_token") ?? "");
      if (!grant || grant.revoked) return Response.json({ error: "invalid_grant" }, { status: 400 });
      return Response.json({
        access_token: this.issueAccessToken(grant),
        expires_in: 3600,
        token_type: "Bearer",
        scope: grant.scope,
      });
    }
    if (body.get("grant_type") !== "authorization_code") {
      return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
    }

    const pending = this.pendingCodes.get(body.get("code") ?? "");
    if (!pending) return Response.json({ error: "invalid_grant" }, { status: 400 });
    this.pendingCodes.delete(body.get("code")!);

    const refreshToken = pending.offline ? `refresh-${++this.counter}` : null;
    const grant = { account: pending.account, scope: pending.scope, refreshToken, revoked: false };
    this.grants.add(grant);

    return Response.json({
      access_token: this.issueAccessToken(grant),
      ...(refreshToken && { refresh_token: refreshToken }),
      expires_in: 3600,
      token_type: "Bearer",
      scope: pending.scope,
      id_token: unsignedIdToken(pending.account),
    });
  }

  // Like Google, revoking any token removes the app's whole authorization for
  // that account, so every token issued to it stops working.
  private async revoke(request: Request) {
    if (this.revocationsFail) return new Response("unavailable", { status: 503 });
    const token = new URLSearchParams(await request.text()).get("token") ?? "";
    const grant = this.grantForRefreshToken(token) ?? this.accessTokens.get(token);
    if (!grant) return Response.json({ error: "invalid_token" }, { status: 400 });
    this.revokeAccessFromGoogle(grant.account.email);
    return new Response(null, { status: 200 });
  }

  private calendarList(request: Request) {
    const accessToken = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const grant = this.accessTokens.get(accessToken);
    if (!grant || grant.revoked) return Response.json({ error: "unauthorized" }, { status: 401 });
    return Response.json({ items: grant.account.calendars });
  }

  private grantForRefreshToken(refreshToken: string) {
    return [...this.grants].find((g) => g.refreshToken === refreshToken);
  }

  private issueAccessToken(grant: Grant) {
    const accessToken = `access-${++this.counter}`;
    this.accessTokens.set(accessToken, grant);
    return accessToken;
  }
}

function unsignedIdToken(account: GoogleAccount) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  return [
    encode({ alg: "none", typ: "JWT" }),
    encode({
      iss: "https://accounts.google.com",
      sub: account.sub,
      email: account.email,
      email_verified: true,
      name: account.name,
      picture: account.picture,
      iat: now,
      exp: now + 3600,
    }),
    "",
  ].join(".");
}
