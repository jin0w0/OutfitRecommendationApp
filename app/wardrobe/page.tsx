import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getAccount } from "@/lib/account/server";
import { getCloset } from "@/lib/outfit/server";
import { SLOT_NAMES } from "@/lib/outfit/clothing-names";
import { SLOTS } from "@/lib/outfit/wardrobe";
import { ClothingPhoto } from "../clothing-photo";

export default function Wardrobe() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">내 옷장</h1>
        <Link href="/home" className="text-sm text-zinc-600 underline dark:text-zinc-400">
          메인으로
        </Link>
      </div>
      <Link href="/wardrobe/new" className="self-start rounded-full bg-foreground px-5 py-2 text-background">
        옷 등록하기
      </Link>
      <Suspense fallback={<div className="h-40" />}>
        <Clothes />
      </Suspense>
    </main>
  );
}

// The 옷장 by 종류, each with how many pieces it has.
async function Clothes() {
  const requestHeaders = await headers();
  const user = await getAccount().getCurrentUser(requestHeaders);
  if (!user) redirect("/?next=/wardrobe");
  const clothes = await getCloset().clothes(user.id);
  if (clothes.length === 0) {
    return <p className="text-zinc-600 dark:text-zinc-400">아직 옷장이 비어 있어요. 첫 옷을 등록해 보세요.</p>;
  }
  return (
    <div className="flex flex-col gap-8">
      {SLOTS.map((slot) => {
        const inSlot = clothes.filter((c) => c.slot === slot);
        return (
          <section key={slot} className="flex flex-col gap-3">
            <h2 className="font-medium">
              {SLOT_NAMES[slot]} <span className="text-sm text-zinc-500">{inSlot.length}벌</span>
            </h2>
            {inSlot.length === 0 ? (
              <p className="text-sm text-zinc-500">아직 없어요.</p>
            ) : (
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {inSlot.map((clothing) => (
                  <li key={clothing.id}>
                    <Link href={`/wardrobe/${clothing.id}`} className="flex flex-col gap-1">
                      <ClothingPhoto clothing={clothing} className="aspect-square w-full" />
                      <span className="text-sm">{clothing.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
