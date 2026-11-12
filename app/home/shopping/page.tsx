import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getAccount } from "@/lib/account/server";
import { COLOR_NAMES, COLOR_SWATCHES, SLOT_NAMES } from "@/lib/outfit/clothing-names";
import type { PurchaseOutfit } from "@/lib/outfit/recommender";
import { getOutfitRecommender } from "@/lib/outfit/server";
import { isEventKind } from "@/lib/outfit/situations";
import type { Clothing, ClothingFields, Slot } from "@/lib/outfit/wardrobe";
import { ClothingPhoto } from "../../clothing-photo";
import { restoreSuggestedClothing } from "../../wardrobe/analysis/actions";
import { homeDate } from "../home-state";

// 구매 추천 코디 for the date and 일정 the main screen was showing.
export default function Shopping({ searchParams }: PageProps<"/home/shopping">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-6 py-12">
      <Suspense fallback={<p className="text-sm text-zinc-500">구매 추천 코디를 만드는 중…</p>}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Content({ searchParams }: Pick<PageProps<"/home/shopping">, "searchParams">) {
  const params = await searchParams;
  const requestHeaders = await headers();
  const user = await getAccount().getCurrentUser(requestHeaders);
  if (!user) redirect("/?next=/home");
  if (!user.homeRegion) redirect("/onboarding");
  const date = homeDate(params.date);
  const situation = isEventKind(params.situation) ? params.situation : null;
  const back = `/home?${new URLSearchParams({ date, ...(situation && { situation }) })}`;

  const result = await getOutfitRecommender().purchaseOutfits({
    userId: user.id,
    date,
    situation,
    location: { latitude: user.homeRegion.latitude, longitude: user.homeRegion.longitude },
  });

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{date} 구매 추천</h1>
        <Link href={back} className="text-sm text-zinc-600 underline dark:text-zinc-400">
          내 옷장 코디로
        </Link>
      </div>
      {result.kind === "unavailable" && (
        <p className="text-zinc-600 dark:text-zinc-400">지금은 구매 추천을 만들 수 없어요. 잠시 뒤에 다시 시도해 주세요.</p>
      )}
      {result.kind === "with-wardrobe" &&
        (result.outfits.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">지금 옷장과 잘 어울릴 새 옷을 찾지 못했어요.</p>
        ) : (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              가진 옷에 한 벌만 더한 코디예요. 새 옷이 가진 옷 몇 벌과 새로 어울리는지도 함께 보여 드려요.
            </p>
            <ul className="flex flex-col gap-4">
              {result.outfits.map((item) => (
                <WithWardrobe key={addedKey(item)} item={item} />
              ))}
            </ul>
          </>
        ))}
      {result.kind === "all-new" &&
        (result.outfits.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">추천할 코디를 찾지 못했어요.</p>
        ) : (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              지금 옷장으로는 이날의 코디를 만들 수 없어서, 새 옷으로만 된 코디를 보여 드려요.
            </p>
            <ul className="flex flex-col gap-4">
              {result.outfits.map((outfit, i) => (
                <li key={i} className="flex flex-wrap gap-3 rounded-xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
                  {(Object.entries(outfit) as [Slot, ClothingFields][]).map(([slot, piece]) => (
                    <NewPiece key={slot} slot={slot} piece={piece} />
                  ))}
                </li>
              ))}
            </ul>
          </>
        ))}
    </>
  );
}

function addedKey({ added }: PurchaseOutfit) {
  return added.kind === "new" ? added.id : added.clothing.id;
}

function WithWardrobe({ item }: { item: PurchaseOutfit }) {
  const addedId = addedKey(item);
  const addedName = item.added.kind === "new" ? item.added.piece.name : item.added.clothing.name;
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap gap-3">
        {(Object.entries(item.outfit) as [Slot, Clothing][]).map(([slot, clothing]) =>
          clothing.id === addedId && item.added.kind === "new" ? (
            <NewPiece key={slot} slot={slot} piece={item.added.piece} />
          ) : (
            <div key={slot} className="flex w-20 flex-col items-center gap-1">
              <ClothingPhoto clothing={clothing} className="h-20 w-20" />
              <span className="text-center text-xs">
                {clothing.id === addedId ? "정리한 옷 · " : ""}
                {clothing.name}
              </span>
            </div>
          ),
        )}
      </div>
      <p className="text-sm">
        {item.added.kind === "new"
          ? `${addedName}이(가) 있으면 가진 옷 ${item.matchesOwned}벌과 새로 어울려요.`
          : `정리한 ${addedName}을(를) 되돌리면 가진 옷 ${item.matchesOwned}벌과 어울려요. 새로 사지 않아도 돼요.`}
      </p>
      {item.added.kind === "restore" && (
        <form action={restoreSuggestedClothing}>
          <input type="hidden" name="clothingId" value={item.added.clothing.id} />
          <input type="hidden" name="returnTo" value="/home" />
          <button type="submit" className="text-sm underline">
            되돌리기
          </button>
        </form>
      )}
    </li>
  );
}

function NewPiece({ slot, piece }: { slot: Slot; piece: ClothingFields }) {
  return (
    <div className="flex w-20 flex-col items-center gap-1">
      <span
        aria-label={COLOR_NAMES[piece.color]}
        className="flex h-20 w-20 items-end justify-center rounded-lg border border-dashed border-zinc-400 pb-1 text-[10px] text-white"
        style={{ backgroundColor: COLOR_SWATCHES[piece.color] }}
      >
        <span className="rounded bg-black/50 px-1">옷장에 없음</span>
      </span>
      <span className="text-center text-xs">
        {SLOT_NAMES[slot]} · {piece.name}
      </span>
    </div>
  );
}
