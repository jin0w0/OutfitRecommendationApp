"use client";

import { authClient } from "@/lib/account/client";

export function SignInButton({ callbackURL }: { callbackURL: string }) {
  return (
    <button
      type="button"
      onClick={() =>
        authClient.signIn.social({
          provider: "google",
          callbackURL,
          errorCallbackURL: "/",
        })
      }
      className="flex h-12 items-center justify-center rounded-full bg-foreground px-6 text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
    >
      구글로 로그인
    </button>
  );
}
