import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getAccount } from "@/lib/account/server";
import { signOut } from "../actions";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-6 py-12">
      <Suspense fallback={<div className="h-10" />}>
        <UserBar />
      </Suspense>
    </main>
  );
}

async function UserBar() {
  const requestHeaders = await headers();
  const user = await getAccount().getCurrentUser(requestHeaders);
  if (!user) redirect("/?next=/home");

  return (
    <header className="flex items-center gap-3">
      {user.image && (
        // eslint-disable-next-line @next/next/no-img-element -- Google avatar URL
        <img src={user.image} alt="" className="h-10 w-10 rounded-full" />
      )}
      <span className="flex-1 font-medium">{user.name}</span>
      <form action={signOut}>
        <button type="submit" className="text-sm text-zinc-600 underline dark:text-zinc-400">
          로그아웃
        </button>
      </form>
    </header>
  );
}
