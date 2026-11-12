import { COLOR_NAMES, COLOR_SWATCHES, SLOT_NAMES } from "@/lib/outfit/clothing-names";
import { suggestionId } from "@/lib/outfit/one-more-piece";
import type { PurchaseOutfit } from "@/lib/outfit/recommender";
import type { Clothing, Slot } from "@/lib/outfit/wardrobe";
import { ClothingPhoto } from "./clothing-photo";
import { dismissPieceSuggestion, restoreSuggestedClothing } from "./wardrobe/analysis/actions";

const SLOT_ORDER: Slot[] = ["outer", "top", "bottom", "dress", "shoes"];

// One 구매 추천 코디: owned clothes as photos, new pieces as swatches marked
// 옷장에 없음, and per added piece how many owned pieces it goes with.
// `dismissFor`: the piece being revived, so new pieces can be dismissed (관심
// 없어요) as its 이 한 벌 제안 would be. `returnTo` is where the forms come back.
export function PurchaseOutfitCard({
  item,
  returnTo,
  dismissFor,
}: {
  item: PurchaseOutfit;
  returnTo: string;
  dismissFor?: string;
}) {
  const addedOf = (clothing: Clothing) => item.added.find((a) => a.clothing.id === clothing.id);
  const owned = Object.values(item.outfit).some((c) => !addedOf(c));
  return (
    <li
      className={`flex flex-col gap-3 rounded-xl border p-4 ${owned ? "border-zinc-200 dark:border-zinc-800" : "border-dashed border-zinc-300 dark:border-zinc-700"}`}
    >
      <div className="flex flex-wrap gap-3">
        {SLOT_ORDER.flatMap((slot) => {
          const clothing = item.outfit[slot as keyof typeof item.outfit];
          if (!clothing) return [];
          const added = addedOf(clothing);
          return added?.kind === "new" ? (
            <NewPiece key={slot} clothing={clothing} />
          ) : (
            <div key={slot} className="flex w-20 flex-col items-center gap-1">
              <ClothingPhoto clothing={clothing} className="h-20 w-20" />
              <span className="text-center text-xs">
                {added ? "정리한 옷 · " : ""}
                {clothing.name}
              </span>
            </div>
          );
        })}
      </div>
      {owned &&
        item.added.map(({ kind, clothing, matchesOwned }) => (
          <div key={clothing.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <p>
              {kind === "new"
                ? `${clothing.name}이(가) 있으면 가진 옷 ${matchesOwned}벌과 새로 어울려요.`
                : `정리한 ${clothing.name}을(를) 되돌리면 가진 옷 ${matchesOwned}벌과 어울려요. 새로 사지 않아도 돼요.`}
            </p>
            {kind === "restore" && (
              <form action={restoreSuggestedClothing}>
                <input type="hidden" name="clothingId" value={clothing.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <button type="submit" className="underline">
                  되돌리기
                </button>
              </form>
            )}
            {kind === "new" && dismissFor && (
              <form action={dismissPieceSuggestion}>
                <input type="hidden" name="suggestionId" value={suggestionId(dismissFor, clothing)} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <button type="submit" className="text-xs text-zinc-500 underline">
                  관심 없어요
                </button>
              </form>
            )}
          </div>
        ))}
    </li>
  );
}

function NewPiece({ clothing }: { clothing: Clothing }) {
  return (
    <div className="flex w-20 flex-col items-center gap-1">
      <span
        aria-label={COLOR_NAMES[clothing.color]}
        className="flex h-20 w-20 items-end justify-center rounded-lg border border-dashed border-zinc-400 pb-1 text-[10px] text-white"
        style={{ backgroundColor: COLOR_SWATCHES[clothing.color] }}
      >
        <span className="rounded bg-black/50 px-1">옷장에 없음</span>
      </span>
      <span className="text-center text-xs">
        {SLOT_NAMES[clothing.slot]} · {clothing.name}
      </span>
    </div>
  );
}
