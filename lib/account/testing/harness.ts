import { PGlite } from "@electric-sql/pglite";
import { PGliteDialect } from "kysely-pglite-dialect";
import { vi } from "vitest";
import { createAccount, type AccountConfig } from "../account";
import { FakeGoogle } from "./fake-google";

export const TEST_BASE_URL = "http://localhost:3000";

export async function createTestAccount(
  options: Pick<AccountConfig, "onCalendarDisconnected" | "onAccountDeleted"> = {},
) {
  const google = new FakeGoogle();
  vi.stubGlobal("fetch", google.fetch);

  const pg = await PGlite.create();
  const account = createAccount({
    dialect: new PGliteDialect(pg),
    baseURL: TEST_BASE_URL,
    secret: "test-secret-that-is-at-least-32-characters",
    google: { clientId: "test-client-id", clientSecret: "test-client-secret" },
    tokenEncryptionKey: "test-token-encryption-key",
    ...options,
  });
  await account.migrate();

  // Runs the browser side of "구글로 로그인": start sign-in, approve on the
  // fake consent screen as `email`, follow the callback. Each call is a new
  // device with its own cookies.
  async function signInWithGoogle(email: string, { callbackURL = "/" } = {}) {
    const browser = new Browser();

    const start = await browser.send(
      new Request(`${TEST_BASE_URL}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "google", callbackURL }),
      }),
    );
    const { url: authorizationURL } = (await start.json()) as { url: string };

    const code = google.approve(authorizationURL, email);
    const state = new URL(authorizationURL).searchParams.get("state")!;
    const callback = await browser.send(
      new Request(`${TEST_BASE_URL}/api/auth/callback/google?code=${code}&state=${state}`),
    );

    return {
      headers: browser.headers(),
      authorizationURL,
      redirectedTo: callback.headers.get("location"),
    };
  }

  // Runs "캘린더 연동" for a signed-in browser: start, approve on the fake
  // consent screen as `email`, and hand the callback back to the account module.
  async function connectCalendar(headers: Headers, email: string, { returnTo = "/settings" } = {}) {
    const authorizationURL = await account.startCalendarConnection(headers, returnTo);
    const code = google.approve(authorizationURL, email);
    const state = new URL(authorizationURL).searchParams.get("state")!;
    const result = await account.completeCalendarConnection(
      headers,
      new URLSearchParams({ code, state }),
    );
    return { ...result, authorizationURL };
  }

  // A cookie jar that talks to the account module's handler.
  class Browser {
    private cookies = new Map<string, string>();

    async send(request: Request) {
      for (const [name, value] of this.headers()) request.headers.set(name, value);
      request.headers.set("origin", TEST_BASE_URL);
      const response = await account.handler(request);
      for (const cookie of response.headers.getSetCookie()) {
        const [pair] = cookie.split(";");
        const [name, ...value] = pair.split("=");
        this.cookies.set(name.trim(), value.join("="));
      }
      return response;
    }

    headers() {
      const cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
      return new Headers(cookie ? { cookie } : {});
    }
  }

  return { account, google, signInWithGoogle, connectCalendar, Browser };
}
