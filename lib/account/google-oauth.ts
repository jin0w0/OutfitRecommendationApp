// The slice of Google's OAuth 2.0 endpoints the 캘린더 연동 flow uses directly
// (sign-in itself goes through Better Auth).

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

export type GoogleClient = { clientId: string; clientSecret: string; redirectURI: string };

export type GoogleTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scope: string;
  idToken: string | null;
};

export function calendarAuthorizationURL(
  client: GoogleClient,
  { state, codeChallenge }: { state: string; codeChallenge: string },
) {
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectURI,
    response_type: "code",
    // openid + email identify which Google account was picked.
    scope: ["openid", "email", CALENDAR_SCOPE].join(" "),
    access_type: "offline",
    prompt: "consent select_account",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export async function exchangeCode(
  client: GoogleClient,
  { code, codeVerifier }: { code: string; codeVerifier: string },
) {
  return requestTokens({
    grant_type: "authorization_code",
    code,
    code_verifier: codeVerifier,
    redirect_uri: client.redirectURI,
    client_id: client.clientId,
    client_secret: client.clientSecret,
  });
}

export async function refreshTokens(client: GoogleClient, refreshToken: string) {
  return requestTokens({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: client.clientId,
    client_secret: client.clientSecret,
  });
}

// null means Google refused the grant (bad code, revoked or expired refresh token).
async function requestTokens(params: Record<string, string>): Promise<GoogleTokens | null> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  if (response.status === 400 || response.status === 401) return null;
  if (!response.ok) throw new Error(`Google token endpoint returned ${response.status}`);

  const body = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    id_token?: string;
  };
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: new Date(Date.now() + body.expires_in * 1000),
    scope: body.scope,
    idToken: body.id_token ?? null,
  };
}

// The id token comes straight from Google's token endpoint over TLS, so its
// claims can be read without verifying the signature.
export function identityFromIdToken(idToken: string) {
  const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString());
  return { googleId: String(payload.sub), email: String(payload.email) };
}
