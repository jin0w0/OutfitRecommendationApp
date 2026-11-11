import { describe, expect, test } from "vitest";
import { createTestAccount } from "./testing/harness";

describe("sign in", () => {
  test("a visitor without a session has no current user", async () => {
    const { account } = await createTestAccount();

    expect(await account.getCurrentUser(new Headers())).toBeNull();
  });

  test("signing in with Google creates a user with the Google profile", async () => {
    const { account, google, signInWithGoogle } = await createTestAccount();
    google.addAccount({
      email: "minji@gmail.com",
      name: "김민지",
      picture: "https://example.com/minji.png",
    });

    const { headers } = await signInWithGoogle("minji@gmail.com");

    expect(await account.getCurrentUser(headers)).toMatchObject({
      name: "김민지",
      email: "minji@gmail.com",
      image: "https://example.com/minji.png",
    });
  });

  test("signing in again with the same Google account returns the same user", async () => {
    const { account, google, signInWithGoogle } = await createTestAccount();
    google.addAccount({ email: "minji@gmail.com", name: "김민지" });

    const laptop = await signInWithGoogle("minji@gmail.com");
    const phone = await signInWithGoogle("minji@gmail.com");

    const first = await account.getCurrentUser(laptop.headers);
    const second = await account.getCurrentUser(phone.headers);
    expect(second?.id).toBe(first?.id);
  });

  test("sign-in asks Google only for the basic profile", async () => {
    const { google, signInWithGoogle } = await createTestAccount();
    google.addAccount({ email: "minji@gmail.com", name: "김민지" });

    const { authorizationURL } = await signInWithGoogle("minji@gmail.com");

    const scopes = new URL(authorizationURL).searchParams.get("scope")!.split(" ");
    expect(scopes.sort()).toEqual(["email", "openid", "profile"]);
  });

  test("after signing in the user returns to the page they were trying to open", async () => {
    const { google, signInWithGoogle } = await createTestAccount();
    google.addAccount({ email: "minji@gmail.com", name: "김민지" });

    const { redirectedTo } = await signInWithGoogle("minji@gmail.com", {
      callbackURL: "/closet",
    });

    expect(redirectedTo).toBe("/closet");
  });
});

describe("home region", () => {
  test("a new user has no home region yet and still needs onboarding", async () => {
    const { account, google, signInWithGoogle } = await createTestAccount();
    google.addAccount({ email: "minji@gmail.com", name: "김민지" });

    const { headers } = await signInWithGoogle("minji@gmail.com");

    expect(await account.getCurrentUser(headers)).toMatchObject({
      homeRegion: null,
      needsOnboarding: true,
    });
  });

  test("choosing a home region finishes onboarding", async () => {
    const { account, google, signInWithGoogle } = await createTestAccount();
    google.addAccount({ email: "minji@gmail.com", name: "김민지" });
    const { headers } = await signInWithGoogle("minji@gmail.com");

    await account.setHomeRegion(headers, "gyeonggi");

    expect(await account.getCurrentUser(headers)).toMatchObject({
      homeRegion: { id: "gyeonggi", name: "경기" },
      needsOnboarding: false,
    });
  });

  test("the home region can be changed later", async () => {
    const { account, google, signInWithGoogle } = await createTestAccount();
    google.addAccount({ email: "minji@gmail.com", name: "김민지" });
    const { headers } = await signInWithGoogle("minji@gmail.com");
    await account.setHomeRegion(headers, "gyeonggi");

    await account.setHomeRegion(headers, "busan");

    expect((await account.getCurrentUser(headers))?.homeRegion?.name).toBe("부산");
  });

  test("a region outside the list is refused", async () => {
    const { account, google, signInWithGoogle } = await createTestAccount();
    google.addAccount({ email: "minji@gmail.com", name: "김민지" });
    const { headers } = await signInWithGoogle("minji@gmail.com");

    await expect(account.setHomeRegion(headers, "atlantis")).rejects.toThrow();
    expect((await account.getCurrentUser(headers))?.homeRegion).toBeNull();
  });
});

describe("sign out", () => {
  test("signing out ends only this device's session", async () => {
    const { account, google, signInWithGoogle } = await createTestAccount();
    google.addAccount({ email: "minji@gmail.com", name: "김민지" });
    const laptop = await signInWithGoogle("minji@gmail.com");
    const phone = await signInWithGoogle("minji@gmail.com");

    await account.signOut(laptop.headers);

    expect(await account.getCurrentUser(laptop.headers)).toBeNull();
    expect(await account.getCurrentUser(phone.headers)).not.toBeNull();
  });

  test("signing out everywhere ends every session of that user only", async () => {
    const { account, google, signInWithGoogle } = await createTestAccount();
    google.addAccount({ email: "minji@gmail.com", name: "김민지" });
    google.addAccount({ email: "jun@gmail.com", name: "이준" });
    const laptop = await signInWithGoogle("minji@gmail.com");
    const schoolPC = await signInWithGoogle("minji@gmail.com");
    const someoneElse = await signInWithGoogle("jun@gmail.com");

    await account.signOutEverywhere(laptop.headers);

    expect(await account.getCurrentUser(laptop.headers)).toBeNull();
    expect(await account.getCurrentUser(schoolPC.headers)).toBeNull();
    expect(await account.getCurrentUser(someoneElse.headers)).not.toBeNull();
  });
});

describe("deleting the account", () => {
  async function minjiWithCalendar(options?: Parameters<typeof createTestAccount>[0]) {
    const harness = await createTestAccount(options);
    harness.google.addAccount({ email: "minji@gmail.com", name: "김민지" });
    harness.google.addAccount({ email: "minji@kangnam.ac.kr", name: "김민지(학교)" });
    const laptop = await harness.signInWithGoogle("minji@gmail.com");
    const phone = await harness.signInWithGoogle("minji@gmail.com");
    await harness.account.setHomeRegion(laptop.headers, "gyeonggi");
    await harness.connectCalendar(laptop.headers, "minji@kangnam.ac.kr");
    const userId = (await harness.account.getCurrentUser(laptop.headers))!.id;
    return { ...harness, laptop: laptop.headers, phone: phone.headers, userId };
  }

  test("deleting signs the user out everywhere", async () => {
    const { account, laptop, phone } = await minjiWithCalendar();

    await account.deleteAccount(laptop);

    expect(await account.getCurrentUser(laptop)).toBeNull();
    expect(await account.getCurrentUser(phone)).toBeNull();
  });

  test("deleting revokes Google access for both the login and the calendar account", async () => {
    const { account, google, laptop } = await minjiWithCalendar();

    await account.deleteAccount(laptop);

    expect(google.isAppAuthorized("minji@gmail.com")).toBe(false);
    expect(google.isAppAuthorized("minji@kangnam.ac.kr")).toBe(false);
  });

  test("deleting still completes when Google's revocation fails", async () => {
    const { account, google, laptop, phone } = await minjiWithCalendar();
    google.failRevocations();

    await account.deleteAccount(laptop);

    expect(await account.getCurrentUser(phone)).toBeNull();
  });

  test("signing in again with the same Google account starts a fresh user", async () => {
    const { account, laptop, userId, signInWithGoogle } = await minjiWithCalendar();

    await account.deleteAccount(laptop);
    const again = await signInWithGoogle("minji@gmail.com");

    const fresh = await account.getCurrentUser(again.headers);
    expect(fresh?.id).not.toBe(userId);
    expect(fresh).toMatchObject({ homeRegion: null, calendarConnection: null });
    expect(await account.getCalendarAccessToken(userId)).toEqual({ status: "not-connected" });
  });

  test("registered cleanup runs for the deleted user", async () => {
    const deleted: string[] = [];
    const { account, laptop, userId } = await minjiWithCalendar({
      onAccountDeleted: async (id) => void deleted.push(id),
    });

    await account.deleteAccount(laptop);

    expect(deleted).toEqual([userId]);
  });

  test("a login account that someone else uses as their calendar is not revoked", async () => {
    const { account, google, laptop, connectCalendar, signInWithGoogle } =
      await minjiWithCalendar();
    google.addAccount({ email: "jun@gmail.com", name: "이준" });
    const { headers: jun } = await signInWithGoogle("jun@gmail.com");
    await connectCalendar(jun, "minji@gmail.com");

    await account.deleteAccount(laptop);

    const junId = (await account.getCurrentUser(jun))!.id;
    expect((await account.getCalendarAccessToken(junId)).status).toBe("ok");
    expect(google.isAppAuthorized("minji@gmail.com")).toBe(true);
  });
});

describe("선호 단계 during onboarding", () => {
  async function minji() {
    const harness = await createTestAccount();
    harness.google.addAccount({ email: "minji@gmail.com", name: "김민지" });
    const { headers } = await harness.signInWithGoogle("minji@gmail.com");
    return { ...harness, headers };
  }

  test("the 선호 단계 comes after the home region, not before", async () => {
    const { account, headers } = await minji();
    expect((await account.getCurrentUser(headers))?.shouldAskPreferences).toBe(false);

    await account.setHomeRegion(headers, "seoul");

    expect((await account.getCurrentUser(headers))?.shouldAskPreferences).toBe(true);
  });

  test("once passed, the 선호 단계 is not shown again", async () => {
    const { account, headers } = await minji();
    await account.setHomeRegion(headers, "seoul");

    await account.passPreferencesStep(headers);

    expect((await account.getCurrentUser(headers))?.shouldAskPreferences).toBe(false);
  });

  test("users who already got past the calendar invite are not asked", async () => {
    const { account, headers } = await minji();
    await account.setHomeRegion(headers, "seoul");

    await account.dismissCalendarInvite(headers);

    expect((await account.getCurrentUser(headers))?.shouldAskPreferences).toBe(false);
  });
});
