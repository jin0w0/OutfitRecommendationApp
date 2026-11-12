import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getAccount } from "@/lib/account/server";
import type { UnwornClothing } from "@/lib/outfit/analysis";
import { daysBetween, todayInKorea } from "@/lib/outfit/dates";
import { getWardrobeAnalysis } from "@/lib/outfit/server";
import { ClothingPhoto } from "../../clothing-photo";

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
  const { clothing, lastWornOn, verdict } = item;
  return (
    <li id={clothing.id} className="flex gap-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <ClothingPhoto clothing={clothing} className="h-20 w-20 shrink-0" />
      <div className="flex flex-1 flex-col gap-1">
        <span className="font-medium">{clothing.name}</span>
        <span className="text-xs text-zinc-500">
          {lastWornOn ? `${daysBetween(lastWornOn, todayInKorea())}일 전에 입었어요` : "아직 입은 기록이 없어요"}
        </span>
        <p className="text-sm">
          {verdict.kind === "new" ? "새로 들어온 옷이에요. 이렇게 입어 보세요." : "왜 잘 안 입으세요?"}
        </p>
      </div>
    </li>
  );
}
