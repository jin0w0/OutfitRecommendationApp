import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getAccount } from "@/lib/account/server";
import { RegionForm } from "../region-form";

export default function Onboarding() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">어디에서 주로 생활하세요?</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          장소가 정해지지 않은 일정은 이 지역의 날씨로 코디를 추천해 드려요. 나중에 설정에서
          바꿀 수 있어요.
        </p>
      </div>
      <Suspense fallback={<div className="h-10" />}>
        <HomeRegionStep />
      </Suspense>
    </main>
  );
}

async function HomeRegionStep() {
  const requestHeaders = await headers();
  const user = await getAccount().getCurrentUser(requestHeaders);
  if (!user) redirect("/?next=/onboarding");

  return <RegionForm current={user.homeRegion} next="/home" submitLabel="다음" />;
}
