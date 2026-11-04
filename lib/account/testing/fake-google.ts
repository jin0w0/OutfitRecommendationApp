// Stands in for Google's OAuth and Calendar HTTP endpoints, so tests run the
// real Better Auth sign-in and linking flows without the network.

export type GoogleProfile = {
  email: string;
  name: string;
  picture?: string;
};

type GoogleAccount = GoogleProfile & { sub: string };

type Grant = {
  account: GoogleAccount;
  scope: string;
  refreshToken: string;
  revoked: boolean;
};

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export class FakeGoogle {
  private accounts = new Map<string, GoogleAccount>();
  private pendingCodes = new Map<string, { account: GoogleAccount; scope: string }>();
  private grants = new Map<string, Grant>();
  private counter = 0;

  addAccount(profile: GoogleProfile) {
    const account = { ...profile, sub: `google-${++this.counter}` };
    this.accounts.set(profile.email, account);
    return account;
  }

  // What the consent screen does: the user picks an account and approves the
  // scopes in the authorization URL, and Google hands back a code.
  approve(authorizationURL: string, email: string) {
    const account = this.accounts.get(email);
    if (!account) throw new Error(`No fake Google account for ${email}`);
    const scope = new URL(authorizationURL).searchParams.get("scope") ?? "";
    const code = `code-${++this.counter}`;
    this.pendingCodes.set(code, { account, scope });
    return code;
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    if (request.url === TOKEN_ENDPOINT) return this.token(request);
    throw new Error(`FakeGoogle: unexpected request to ${request.url}`);
  };

  private async token(request: Request) {
    const body = new URLSearchParams(await request.text());
    if (body.get("grant_type") !== "authorization_code") {
      return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
    }

    const pending = this.pendingCodes.get(body.get("code") ?? "");
    if (!pending) return Response.json({ error: "invalid_grant" }, { status: 400 });
    this.pendingCodes.delete(body.get("code")!);

    const refreshToken = `refresh-${++this.counter}`;
    this.grants.set(refreshToken, { ...pending, refreshToken, revoked: false });

    return Response.json({
      access_token: `access-${++this.counter}`,
      refresh_token: refreshToken,
      expires_in: 3600,
      token_type: "Bearer",
      scope: pending.scope,
      id_token: unsignedIdToken(pending.account),
    });
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
