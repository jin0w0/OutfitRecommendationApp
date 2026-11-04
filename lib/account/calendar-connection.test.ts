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

describe("calendar selection", () => {
  async function connectedWithCalendars() {
    const harness = await createTestAccount();
    harness.google.addAccount({ email: "minji@gmail.com", name: "김민지" });
    harness.google.addAccount({
      email: "minji@kangnam.ac.kr",
      name: "김민지(학교)",
      calendars: [
        { id: "minji@kangnam.ac.kr", summary: "김민지", primary: true },
        { id: "timetable", summary: "수업 시간표" },
        { id: "ko.south_korea#holiday", summary: "대한민국의 휴일" },
      ],
    });
    const { headers } = await harness.signInWithGoogle("minji@gmail.com");
    await harness.connectCalendar(headers, "minji@kangnam.ac.kr");
    return { ...harness, headers };
  }

  test("right after connecting, only the primary calendar is selected", async () => {
    const { account, headers } = await connectedWithCalendars();

    expect(await account.listCalendars(headers)).toEqual([
      { id: "minji@kangnam.ac.kr", name: "김민지", primary: true, selected: true },
      { id: "timetable", name: "수업 시간표", primary: false, selected: false },
      { id: "ko.south_korea#holiday", name: "대한민국의 휴일", primary: false, selected: false },
    ]);
  });

  test("the user can change which calendars are read", async () => {
    const { account, headers } = await connectedWithCalendars();

    await account.selectCalendars(headers, ["minji@kangnam.ac.kr", "timetable"]);

    const user = await account.getCurrentUser(headers);
    expect(await account.getSelectedCalendarIds(user!.id)).toEqual([
      "minji@kangnam.ac.kr",
      "timetable",
    ]);
  });

  test("a calendar that is not in the connected account cannot be selected", async () => {
    const { account, headers } = await connectedWithCalendars();

    await expect(account.selectCalendars(headers, ["someone-elses-calendar"])).rejects.toThrow();

    const user = await account.getCurrentUser(headers);
    expect(await account.getSelectedCalendarIds(user!.id)).toEqual(["minji@kangnam.ac.kr"]);
  });
});

describe("calendar invite during onboarding", () => {
  async function minjiAfterHomeRegion() {
    const harness = await minjiWithSchoolAccount();
    await harness.account.setHomeRegion(harness.headers, "gyeonggi");
    return harness;
  }

  test("after choosing a home region, a new user is invited to connect a calendar", async () => {
    const { account, headers } = await minjiAfterHomeRegion();

    expect((await account.getCurrentUser(headers))?.shouldInviteCalendar).toBe(true);
  });

  test("once skipped, the invite is not shown again", async () => {
    const { account, headers } = await minjiAfterHomeRegion();

    await account.dismissCalendarInvite(headers);

    expect((await account.getCurrentUser(headers))?.shouldInviteCalendar).toBe(false);
  });

  test("starting a connection from the invite counts as having seen it", async () => {
    const { account, headers } = await minjiAfterHomeRegion();

    await account.startCalendarConnection(headers, "/home");

    expect((await account.getCurrentUser(headers))?.shouldInviteCalendar).toBe(false);
  });

  test("the invite is not shown before the home region is chosen", async () => {
    const { account, headers } = await minjiWithSchoolAccount();

    expect((await account.getCurrentUser(headers))?.shouldInviteCalendar).toBe(false);
  });
});

describe("reconnecting", () => {
  async function connectedToSchoolCalendars() {
    const harness = await createTestAccount();
    harness.google.addAccount({ email: "minji@gmail.com", name: "김민지" });
    harness.google.addAccount({
      email: "minji@kangnam.ac.kr",
      name: "김민지(학교)",
      calendars: [
        { id: "minji@kangnam.ac.kr", summary: "김민지", primary: true },
        { id: "timetable", summary: "수업 시간표" },
      ],
    });
    const { headers } = await harness.signInWithGoogle("minji@gmail.com");
    await harness.connectCalendar(headers, "minji@kangnam.ac.kr");
    const user = await harness.account.getCurrentUser(headers);
    return { ...harness, headers, userId: user!.id };
  }

  const twoHoursLater = () =>
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 2 * 60 * 60 * 1000 });

  test("when the refresh token stops working, the connection needs reconnecting", async () => {
    const { account, google, headers, userId } = await connectedToSchoolCalendars();
    google.revokeAccessFromGoogle("minji@kangnam.ac.kr");

    twoHoursLater();
    const token = await account.getCalendarAccessToken(userId);
    vi.useRealTimers();

    expect(token).toEqual({ status: "reconnect-needed" });
    expect((await account.getCurrentUser(headers))?.calendarConnection).toEqual({
      email: "minji@kangnam.ac.kr",
      status: "reconnect-needed",
    });
  });

  test("access revoked in Google settings is noticed when the calendars are read", async () => {
    const { account, google, headers } = await connectedToSchoolCalendars();
    google.revokeAccessFromGoogle("minji@kangnam.ac.kr");

    expect(await account.listCalendars(headers)).toEqual([]);
    expect((await account.getCurrentUser(headers))?.calendarConnection?.status).toBe(
      "reconnect-needed",
    );
  });

  test("reconnecting the same account restores the connection and keeps the chosen calendars", async () => {
    const { account, google, headers, userId, connectCalendar } = await connectedToSchoolCalendars();
    await account.selectCalendars(headers, ["minji@kangnam.ac.kr", "timetable"]);
    google.revokeAccessFromGoogle("minji@kangnam.ac.kr");
    twoHoursLater();
    await account.getCalendarAccessToken(userId);
    vi.useRealTimers();

    await connectCalendar(headers, "minji@kangnam.ac.kr");

    expect((await account.getCurrentUser(headers))?.calendarConnection?.status).toBe("connected");
    expect((await account.getCalendarAccessToken(userId)).status).toBe("ok");
    expect(await account.getSelectedCalendarIds(userId)).toEqual([
      "minji@kangnam.ac.kr",
      "timetable",
    ]);
  });
});

describe("disconnecting", () => {
  async function connectedToSchool(options?: Parameters<typeof createTestAccount>[0]) {
    const harness = await createTestAccount(options);
    harness.google.addAccount({ email: "minji@gmail.com", name: "김민지" });
    harness.google.addAccount({ email: "minji@kangnam.ac.kr", name: "김민지(학교)" });
    const { headers } = await harness.signInWithGoogle("minji@gmail.com");
    await harness.connectCalendar(headers, "minji@kangnam.ac.kr");
    const user = await harness.account.getCurrentUser(headers);
    return { ...harness, headers, userId: user!.id };
  }

  test("disconnecting removes the connection and revokes the app's Google access", async () => {
    const { account, google, headers, userId } = await connectedToSchool();

    await account.disconnectCalendar(headers);

    expect((await account.getCurrentUser(headers))?.calendarConnection).toBeNull();
    expect(await account.getCalendarAccessToken(userId)).toEqual({ status: "not-connected" });
    expect(await account.getSelectedCalendarIds(userId)).toEqual([]);
    expect(google.isAppAuthorized("minji@kangnam.ac.kr")).toBe(false);
  });

  test("disconnecting still completes when Google's revocation fails", async () => {
    const { account, google, headers } = await connectedToSchool();
    google.failRevocations();

    await account.disconnectCalendar(headers);

    expect((await account.getCurrentUser(headers))?.calendarConnection).toBeNull();
  });

  test("another user's connection to the same Google account keeps working", async () => {
    const { account, google, headers, connectCalendar, signInWithGoogle } =
      await connectedToSchool();
    google.addAccount({ email: "jun@gmail.com", name: "이준" });
    const { headers: jun } = await signInWithGoogle("jun@gmail.com");
    await connectCalendar(jun, "minji@kangnam.ac.kr");
    const junId = (await account.getCurrentUser(jun))!.id;

    await account.disconnectCalendar(headers);

    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 2 * 60 * 60 * 1000 });
    const token = await account.getCalendarAccessToken(junId);
    vi.useRealTimers();
    expect(token.status).toBe("ok");
  });

  test("disconnecting a calendar that is also the login account keeps the user signed in", async () => {
    const { account, headers, connectCalendar } = await connectedToSchool();
    await connectCalendar(headers, "minji@gmail.com");

    await account.disconnectCalendar(headers);

    expect(await account.getCurrentUser(headers)).toMatchObject({
      email: "minji@gmail.com",
      calendarConnection: null,
    });
  });

  test("registered cleanup runs when a calendar is disconnected", async () => {
    const cleaned: string[] = [];
    const { account, headers, userId } = await connectedToSchool({
      onCalendarDisconnected: async (id) => void cleaned.push(id),
    });

    await account.disconnectCalendar(headers);

    expect(cleaned).toEqual([userId]);
  });

  test("switching to another Google account follows the same rules as disconnecting", async () => {
    const cleaned: string[] = [];
    const { account, google, headers, userId, connectCalendar } = await connectedToSchool({
      onCalendarDisconnected: async (id) => void cleaned.push(id),
    });
    google.addAccount({ email: "club@gmail.com", name: "동아리" });

    await connectCalendar(headers, "club@gmail.com");

    expect((await account.getCurrentUser(headers))?.calendarConnection?.email).toBe(
      "club@gmail.com",
    );
    expect(google.isAppAuthorized("minji@kangnam.ac.kr")).toBe(false);
    expect(cleaned).toEqual([userId]);
    expect(await account.getSelectedCalendarIds(userId)).toEqual(["club@gmail.com"]);
  });
});
