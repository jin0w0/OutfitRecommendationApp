import { Suspense } from "react";
import { SignInButton } from "./sign-in-button";

export default function Intro({ searchParams }: PageProps<"/">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-8 px-6 py-24">
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">
          오늘 뭐 입지? 이유까지 알려주는 코디 추천
        </h1>
        <p className="text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          내 옷장의 옷으로, 그날의 일정과 날씨에 맞는 코디를 추천하고 왜 그 코디인지
          설명해 드려요.
        </p>
      </div>
      <Suspense fallback={<div className="h-12" />}>
        <SignIn searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function SignIn({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  const { next, error } = await searchParams;
  return (
    <div className="flex flex-col items-start gap-3">
      <SignInButton callbackURL={safeReturnPath(next)} />
      {error && (
        <p role="alert" className="text-sm text-red-600">
          로그인하지 못했어요. 다시 시도해 주세요.
        </p>
      )}
    </div>
  );
}

// Only same-site paths, so the sign-in link can't bounce users elsewhere.
function safeReturnPath(next: string | string[] | undefined) {
  if (typeof next === "string" && next.startsWith("/") && !next.startsWith("//")) {
    return next;
  }
  return "/home";
}
