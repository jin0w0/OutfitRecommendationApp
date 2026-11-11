import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getAccount } from "@/lib/account/server";
import { COLOR_NAMES } from "@/lib/outfit/clothing-names";
import { getCloset } from "@/lib/outfit/server";
import type { Color } from "@/lib/outfit/wardrobe";

export default function Wardrobe() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">내 옷장</h1>
        <a href="/home" className="text-sm text-zinc-600 underline dark:text-zinc-400">
          메인으로
        </a>
      </div>
      <a href="/wardrobe/new" className="self-start rounded-full bg-foreground px-5 py-2 text-background">
        옷 등록하기
      </a>
      <Suspense fallback={<div className="h-40" />}>
        <Clothes />
      </Suspense>
    </main>
  );
}

async function Clothes() {
  const requestHeaders = await headers();
  const user = await getAccount().getCurrentUser(requestHeaders);
  if (!user) redirect("/?next=/wardrobe");
  const clothes = await getCloset().clothes(user.id);
  if (clothes.length === 0) {
    return <p className="text-zinc-600 dark:text-zinc-400">아직 옷장이 비어 있어요.</p>;
  }
  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {clothes.map((clothing) => (
        <li key={clothing.id} className="flex flex-col gap-1">
          {clothing.hasPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element -- a short-lived private URL
            <img
              src={`/api/clothing/${clothing.id}/photo`}
              alt=""
              className="aspect-square w-full rounded-lg object-cover"
            />
          ) : (
            <div className="aspect-square w-full rounded-lg bg-zinc-100 dark:bg-zinc-900" />
          )}
          <span className="text-sm">{clothing.name}</span>
          <span className="text-xs text-zinc-500">{COLOR_NAMES[clothing.color as Color] ?? clothing.color}</span>
        </li>
      ))}
    </ul>
  );
}
