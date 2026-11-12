import Link from "next/link";
import { verdictSentence } from "@/lib/outfit/analysis-sentences";
import { getWardrobeAnalysis } from "@/lib/outfit/server";
import { ClothingPhoto } from "../clothing-photo";
import { showAnotherWeeklyPick } from "../wardrobe/analysis/actions";

// 이번 주에 꺼내 볼 옷: nothing when there is none.
export async function WeeklyPick({ userId }: { userId: string }) {
  const pick = await getWardrobeAnalysis().weeklyPick(userId);
  if (!pick) return null;
  return (
    <section className="flex gap-4 rounded-xl bg-zinc-50 p-4 dark:bg-zinc-900">
      <ClothingPhoto clothing={pick.clothing} className="h-20 w-20 shrink-0" />
      <div className="flex flex-1 flex-col gap-1">
        <span className="text-xs text-zinc-500">이번 주에 꺼내 볼 옷</span>
        <Link href={`/wardrobe/analysis/${pick.clothing.id}`} className="font-medium underline-offset-2 hover:underline">
          {pick.clothing.name}
        </Link>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{verdictSentence(pick)}</p>
        {pick.hasOthers && (
          <form action={showAnotherWeeklyPick}>
            <button type="submit" className="text-xs text-zinc-500 underline">
              다른 옷 보기
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
