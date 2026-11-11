import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getAccount } from "@/lib/account/server";
import { getCloset } from "@/lib/outfit/server";
import { ClothingPhoto } from "../../clothing-photo";
import { restoreClothing } from "../actions";

export default function TidiedClothes() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">정리한 옷</h1>
        <Link href="/wardrobe" className="text-sm text-zinc-600 underline dark:text-zinc-400">
          옷장으로
        </Link>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        정리한 옷은 추천에 나오지 않아요. 지난 착용 기록에는 그대로 남아 있고, 언제든 옷장으로 되돌릴 수 있어요.
      </p>
      <Suspense fallback={<div className="h-40" />}>
        <List />
      </Suspense>
    </main>
  );
}

async function List() {
  const requestHeaders = await headers();
  const user = await getAccount().getCurrentUser(requestHeaders);
  if (!user) redirect("/?next=/wardrobe/tidied");
  const clothes = await getCloset().tidiedClothes(user.id);
  if (clothes.length === 0) return <p className="text-zinc-600 dark:text-zinc-400">정리한 옷이 없어요.</p>;
  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
      {clothes.map((clothing) => (
        <li key={clothing.id} className="flex flex-col gap-1">
          <ClothingPhoto clothing={clothing} className="aspect-square w-full opacity-60" />
          <span className="text-sm">{clothing.name}</span>
          <form action={restoreClothing}>
            <input type="hidden" name="clothingId" value={clothing.id} />
            <button type="submit" className="text-xs underline">
              옷장으로 되돌리기
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}
