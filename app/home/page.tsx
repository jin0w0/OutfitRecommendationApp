import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { CurrentUser } from "@/lib/account/account";
import { getAccount } from "@/lib/account/server";
import { getCloset, getOutfitRecommender, getPieceSuggestions } from "@/lib/outfit/server";
import { isEventKind } from "@/lib/outfit/situations";
import { signOut } from "../actions";
import { ReconnectNotice } from "../reconnect-notice";
import { WeeklyPick } from "./weekly-pick";
import { PieceSuggestionCards } from "../piece-suggestions";
import { OutfitRequestForm, RecommendationView } from "./recommendation";
import { homeDate, noticeFrom, shownFrom } from "./home-state";

export default function Home({ searchParams }: PageProps<"/home">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-6 py-12">
      <Suspense fallback={<div className="h-10" />}>
        <HomeContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function HomeContent({ searchParams }: Pick<PageProps<"/home">, "searchParams">) {
  const requestHeaders = await headers();
  const user = await getAccount().getCurrentUser(requestHeaders);
  if (!user) redirect("/?next=/home");
  if (user.needsOnboarding || user.shouldAskPreferences || user.shouldInviteCalendar) redirect("/onboarding");

  // Nothing to recommend from yet: 옷 등록 comes first.
  if ((await getCloset().clothes(user.id)).length === 0) {
    return (
      <>
        <UserBar user={user} />
        <EmptyWardrobe />
      </>
    );
  }

  const params = await searchParams;
  const date = homeDate(params.date);
  const situation = isEventKind(params.situation) ? params.situation : null;
  // Onboarding above guarantees a 기본 지역.
  const { name: regionName, latitude, longitude } = user.homeRegion!;
  const shown = shownFrom(params);
  const recommender = getOutfitRecommender();
  // The 추천 세션 being revised, if it is still there, else a fresh 추천.
  const sessionId = typeof params.session === "string" ? params.session : null;
  const continued = sessionId && (await recommender.latest({ userId: user.id, sessionId }));
  const recommendation =
    continued && continued.date === date
      ? continued
      : await recommender.recommendForDate({
          userId: user.id,
          date,
          situation,
          location: { latitude, longitude },
          shown,
          // 고정 추천 from the 옷장 분석.
          fixedClothingId: typeof params.fixed === "string" ? params.fixed : undefined,
        });

  return (
    <>
      <UserBar user={user} />
      <WeeklyPick userId={user.id} />
      {(user.calendarConnection?.status === "reconnect-needed" ||
        recommendation.missing.includes("calendar-reconnect-needed")) && (
        <ReconnectNotice returnTo="/home" />
      )}
      <OutfitRequestForm date={date} situation={situation} />
      <RecommendationView
        recommendation={recommendation}
        regionName={regionName}
        situation={situation}
        shown={shown}
        notice={continued ? noticeFrom(params) : null}
      />
      {recommendation.status === "unbuildable" && (
        <PieceSuggestionCards
          suggestions={(
            await Promise.all(recommendation.missingSlots.map((slot) => getPieceSuggestions().filling(user.id, slot)))
          ).flat()}
          returnTo="/home"
        />
      )}
    </>
  );
}

function EmptyWardrobe() {
  return (
    <section className="flex flex-col items-start gap-4 rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
      <h2 className="text-xl font-semibold">먼저 옷장을 채워 주세요</h2>
      <p className="text-zinc-600 dark:text-zinc-400">
        옷 사진을 올리면 AI가 종류와 색을 알아서 채워 줘요. 상의, 하의, 신발이 한 벌씩 있으면 첫 코디를 추천받을 수
        있어요.
      </p>
      <Link href="/wardrobe/new" className="rounded-full bg-foreground px-6 py-3 text-background">
        옷 등록하기
      </Link>
    </section>
  );
}

function UserBar({ user }: { user: CurrentUser }) {
  return (
    <header className="flex items-center gap-3">
      {user.image && (
        // eslint-disable-next-line @next/next/no-img-element -- Google avatar URL
        <img src={user.image} alt="" className="h-10 w-10 rounded-full" />
      )}
      <span className="flex-1 font-medium">{user.name}</span>
      <Link href="/wardrobe/new" className="text-sm text-zinc-600 underline dark:text-zinc-400">
        옷 등록
      </Link>
      <Link href="/wardrobe" className="text-sm text-zinc-600 underline dark:text-zinc-400">
        옷장
      </Link>
      <Link href="/settings" className="text-sm text-zinc-600 underline dark:text-zinc-400">
        설정
      </Link>
      <form action={signOut}>
        <button type="submit" className="text-sm text-zinc-600 underline dark:text-zinc-400">
          로그아웃
        </button>
      </form>
    </header>
  );
}
