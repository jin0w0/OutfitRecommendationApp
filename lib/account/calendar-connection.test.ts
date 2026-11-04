import { describe, expect, test, vi } from "vitest";
import { createTestAccount } from "./testing/harness";

async function minjiWithSchoolAccount() {
  const harness = await createTestAccount();
  harness.google.addAccount({ email: "minji@gmail.com", name: "김민지" });
  harness.google.addAccount({ email: "minji@kangnam.ac.kr", name: "김민지(학교)" });
  const { headers } = await harness.signInWithGoogle("minji@gmail.com");
  return { ...harness, headers };
}

describe("calendar connection", () => {
  test("the calendar can come from a different Google account than the login", async () => {
    const { account, google, headers, connectCalendar } = await minjiWithSchoolAccount();

    await connectCalendar(headers, "minji@kangnam.ac.kr");

    const user = await account.getCurrentUser(headers);
    expect(user?.calendarConnection).toEqual({ email: "minji@kangnam.ac.kr", status: "connected" });
    const token = await account.getCalendarAccessToken(user!.id);
    expect(token.status).toBe("ok");
    expect(google.ownerOfAccessToken(token.status === "ok" ? token.accessToken : "")).toBe(
      "minji@kangnam.ac.kr",
    );
  });

  test("the consent screen asks only to read the calendar, offline, with an account picker", async () => {
    const { headers, connectCalendar } = await minjiWithSchoolAccount();

    const { authorizationURL } = await connectCalendar(headers, "minji@kangnam.ac.kr");

    const params = new URL(authorizationURL).searchParams;
    expect(params.get("scope")!.split(" ").sort()).toEqual([
      "email",
      "https://www.googleapis.com/auth/calendar.readonly",
      "openid",
    ]);
    expect(params.get("access_type")).toBe("offline");
    expect(params.get("prompt")).toContain("select_account");
  });

  test("a connected calendar account cannot be used to sign in as that user", async () => {
    const { account, headers, connectCalendar, signInWithGoogle } = await minjiWithSchoolAccount();
    await connectCalendar(headers, "minji@kangnam.ac.kr");

    const viaSchool = await signInWithGoogle("minji@kangnam.ac.kr");

    const minji = await account.getCurrentUser(headers);
    const schoolUser = await account.getCurrentUser(viaSchool.headers);
    expect(schoolUser?.id).not.toBe(minji?.id);
    expect(schoolUser?.calendarConnection).toBeNull();
  });

  test("the login account itself can be connected as the calendar", async () => {
    const { account, google, headers, connectCalendar } = await minjiWithSchoolAccount();

    await connectCalendar(headers, "minji@gmail.com");

    const user = await account.getCurrentUser(headers);
    const token = await account.getCalendarAccessToken(user!.id);
    expect(token.status === "ok" && google.ownerOfAccessToken(token.accessToken)).toBe(
      "minji@gmail.com",
    );
    expect(user?.email).toBe("minji@gmail.com");
  });

  test("several users can connect the same Google calendar independently", async () => {
    const { account, google, headers: minji, connectCalendar, signInWithGoogle } =
      await minjiWithSchoolAccount();
    google.addAccount({ email: "jun@gmail.com", name: "이준" });
    google.addAccount({ email: "team@gmail.com", name: "팀 계정" });
    const { headers: jun } = await signInWithGoogle("jun@gmail.com");

    await connectCalendar(minji, "team@gmail.com");
    await connectCalendar(jun, "team@gmail.com");

    for (const headers of [minji, jun]) {
      const user = await account.getCurrentUser(headers);
      expect(user?.calendarConnection?.email).toBe("team@gmail.com");
      expect((await account.getCalendarAccessToken(user!.id)).status).toBe("ok");
    }
  });

  test("a connection request started by someone else cannot be completed", async () => {
    const { account, google, headers: minji, signInWithGoogle } = await minjiWithSchoolAccount();
    google.addAccount({ email: "jun@gmail.com", name: "이준" });
    const { headers: jun } = await signInWithGoogle("jun@gmail.com");

    const authorizationURL = await account.startCalendarConnection(minji, "/settings");
    const code = google.approve(authorizationURL, "jun@gmail.com");
    const state = new URL(authorizationURL).searchParams.get("state")!;
    const result = await account.completeCalendarConnection(
      jun,
      new URLSearchParams({ code, state }),
    );

    expect(result.status).toBe("failed");
    expect((await account.getCurrentUser(jun))?.calendarConnection).toBeNull();
    expect((await account.getCurrentUser(minji))?.calendarConnection).toBeNull();
  });

  test("cancelling on Google's consent screen leaves no connection", async () => {
    const { account, headers } = await minjiWithSchoolAccount();

    const authorizationURL = await account.startCalendarConnection(headers, "/settings");
    const state = new URL(authorizationURL).searchParams.get("state")!;
    const result = await account.completeCalendarConnection(
      headers,
      new URLSearchParams({ error: "access_denied", state }),
    );

    expect(result).toEqual({ status: "cancelled", returnTo: "/settings" });
    expect((await account.getCurrentUser(headers))?.calendarConnection).toBeNull();
  });

  test("an expired access token is refreshed when asked for", async () => {
    const { account, google, headers, connectCalendar } = await minjiWithSchoolAccount();
    await connectCalendar(headers, "minji@kangnam.ac.kr");
    const user = await account.getCurrentUser(headers);
    const first = await account.getCalendarAccessToken(user!.id);

    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 2 * 60 * 60 * 1000 });
    const later = await account.getCalendarAccessToken(user!.id);
    vi.useRealTimers();

    expect(later.status).toBe("ok");
    expect(later).not.toEqual(first);
    expect(google.ownerOfAccessToken(later.status === "ok" ? later.accessToken : "")).toBe(
      "minji@kangnam.ac.kr",
    );
  });

  test("a user without a calendar connection gets no token", async () => {
    const { account, headers } = await minjiWithSchoolAccount();
    const user = await account.getCurrentUser(headers);

    expect(await account.getCalendarAccessToken(user!.id)).toEqual({ status: "not-connected" });
  });
});
