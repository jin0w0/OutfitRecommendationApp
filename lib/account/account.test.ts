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
