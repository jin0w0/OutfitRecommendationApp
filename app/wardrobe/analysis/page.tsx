import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getAccount } from "@/lib/account/server";
import type { UnwornClothing } from "@/lib/outfit/analysis";
import { CARE_TIPS, verdictSentence } from "@/lib/outfit/analysis-sentences";
import { ANSWERS, type Answer } from "@/lib/outfit/analysis-store";
import { daysBetween, todayInKorea } from "@/lib/outfit/dates";
import { getWardrobeAnalysis } from "@/lib/outfit/server";
import { ClothingPhoto } from "../../clothing-photo";
import { answerAboutClothing, keepClothingAsIs, tidyFromAnalysis } from "./actions";

export default function WardrobeAnalysis() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">옷장 분석</h1>
        <Link href="/wardrobe" className="text-sm text-zinc-600 underline dark:text-zinc-400">
          옷장으로
        </Link>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        30일 넘게 입지 않은 옷과, 왜 손이 안 가는지 정리했어요.
      </p>
      <Suspense fallback={<div className="h-40" />}>
        <Unworn />
      </Suspense>
    </main>
  );
}

async function Unworn() {
  const requestHeaders = await headers();
  const user = await getAccount().getCurrentUser(requestHeaders);
  if (!user) redirect("/?next=/wardrobe/analysis");
  const unworn = await getWardrobeAnalysis().analyze(user.id);
  if (unworn.length === 0) {
    return <p className="text-zinc-600 dark:text-zinc-400">요즘 옷장을 고르게 잘 입고 계세요. 안 입는 옷이 없어요.</p>;
  }
  return (
    <ul className="flex flex-col gap-4">
      {unworn.map((item) => (
        <UnwornCard key={item.clothing.id} item={item} />
      ))}
    </ul>
  );
}

function UnwornCard({ item }: { item: UnwornClothing }) {
  const { clothing, lastWornOn } = item;
  return (
    <li id={clothing.id} className="flex gap-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <ClothingPhoto clothing={clothing} className="h-20 w-20 shrink-0" />
      <div className="flex flex-1 flex-col gap-1">
        <span className="font-medium">{clothing.name}</span>
        <span className="text-xs text-zinc-500">
          {lastWornOn ? `${daysBetween(lastWornOn, todayInKorea())}일 전에 입었어요` : "아직 입은 기록이 없어요"}
        </span>
        <p className="text-sm">{verdictSentence(item)}</p>
        {item.verdict.kind === "ask" && <AnswerButtons clothingId={clothing.id} />}
        {item.remedies.includes("care-tips") && (
          <p className="rounded-md bg-zinc-50 p-2 text-sm dark:bg-zinc-900">{CARE_TIPS[clothing.material]}</p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
          {item.remedies.includes("tidy-suggestion") && (
            <form action={tidyFromAnalysis}>
              <input type="hidden" name="clothingId" value={clothing.id} />
              <button type="submit" className="rounded-full border border-zinc-300 px-3 py-1 dark:border-zinc-700">
                정리하기
              </button>
            </form>
          )}
          <form action={keepClothingAsIs}>
            <input type="hidden" name="clothingId" value={clothing.id} />
            <button type="submit" className="text-zinc-500 underline">
              그대로 둘게요
            </button>
          </form>
        </div>
      </div>
    </li>
  );
}

const ANSWER_LABELS: Record<Answer, string> = {
  care: "관리가 번거로워요",
  "changed-mind": "더 이상 마음에 안 들어요",
  forgot: "그냥 잊고 있었어요",
};

function AnswerButtons({ clothingId }: { clothingId: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {ANSWERS.map((answer) => (
        <form key={answer} action={answerAboutClothing}>
          <input type="hidden" name="clothingId" value={clothingId} />
          <input type="hidden" name="answer" value={answer} />
          <button type="submit" className="rounded-full bg-zinc-100 px-3 py-1 text-sm dark:bg-zinc-800">
            {ANSWER_LABELS[answer]}
          </button>
        </form>
      ))}
    </div>
  );
}
