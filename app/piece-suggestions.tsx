import { COLOR_NAMES, COLOR_SWATCHES } from "@/lib/outfit/clothing-names";
import type { PieceSuggestion } from "@/lib/outfit/one-more-piece";
import Link from "next/link";
import { dismissPieceSuggestion, restoreSuggestedClothing } from "./wardrobe/analysis/actions";
import { PendingButton } from "./pending-button";

// 이 한 벌 제안 cards: pieces the 옷장 lacks (or a 정리한 옷 to restore), each
// with the new 코디 it would bring. `returnTo` is where restoring comes back.
export function PieceSuggestionCards({
  suggestions,
  returnTo,
}: {
  suggestions: PieceSuggestion[];
  returnTo: string;
}) {
  if (suggestions.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">이 한 벌이 있으면</h2>
      <ul className="flex flex-col gap-2">
        {suggestions.map((suggestion) => {
          const color = suggestion.kind === "new" ? suggestion.piece.color : suggestion.clothing.color;
          return (
            <li
              key={suggestion.id}
              className="flex items-center gap-3 rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-700"
            >
              <span
                aria-label={COLOR_NAMES[color]}
                className="h-10 w-10 shrink-0 rounded-md border border-zinc-200 dark:border-zinc-700"
                style={{ backgroundColor: COLOR_SWATCHES[color] }}
              />
              <div className="flex flex-1 flex-col gap-0.5 text-sm">
                {suggestion.kind === "new" ? (
                  <>
                    <span>
                      <span className="mr-1 rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">옷장에 없는 옷</span>
                      {suggestion.piece.name}
                    </span>
                    <span className="text-zinc-500">있으면 잘 어울리는 코디가 {suggestion.newOutfits}개 생겨요.</span>
                  </>
                ) : (
                  <>
                    <span>정리한 {suggestion.clothing.name}을(를) 되돌려 보세요.</span>
                    <span className="text-zinc-500">
                      새로 사지 않아도 잘 어울리는 코디가 {suggestion.newOutfits}개 생겨요.
                    </span>
                  </>
                )}
              </div>
              {suggestion.kind === "new" && (
                <div className="flex flex-col items-end gap-1 text-xs">
                  <Link href="/wardrobe/new" className="underline">
                    이미 있어요
                  </Link>
                  <form action={dismissPieceSuggestion}>
                    <input type="hidden" name="suggestionId" value={suggestion.id} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <PendingButton pending="다른 옷을 찾는 중…" className="text-zinc-500 underline">
                      관심 없어요
                    </PendingButton>
                  </form>
                </div>
              )}
              {suggestion.kind === "restore" && (
                <form action={restoreSuggestedClothing}>
                  <input type="hidden" name="clothingId" value={suggestion.clothing.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <button type="submit" className="text-sm underline">
                    되돌리기
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
