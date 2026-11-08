import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { CurrentUser } from "@/lib/account/account";
import { getAccount } from "@/lib/account/server";
import { getOutfitRecommender } from "@/lib/outfit/server";
import { isEventKind } from "@/lib/outfit/situations";
import { signOut } from "../actions";
import { ReconnectNotice } from "../reconnect-notice";
import { OutfitRequestForm, RecommendationView } from "./recommendation";
import { isSlot, type RevisionNotice } from "./revision-labels";

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
  if (user.needsOnboarding || user.shouldInviteCalendar) redirect("/onboarding");

  const params = await searchParams;
  const date =
    typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
      ? params.date
      : todayInKorea();
  const situation = isEventKind(params.situation) ? params.situation : null;
  // Onboarding above guarantees a 기본 지역.
  const { name: regionName, latitude, longitude } = user.homeRegion!;
  // 코디 already shown for this date (다시 추천받기), each as dot-joined clothing ids.
  const shown = [params.shown ?? []].flat().map((outfit) => outfit.split("."));
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
        });

  return (
    <>
      <UserBar user={user} />
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
        notice={continued ? revisionNotice(params) : null}
      />
    </>
  );
}

// What the last 대화 message changed nothing for, as reviseOutfit put it in the URL.
function revisionNotice(params: Record<string, string | string[] | undefined>): RevisionNotice | null {
  switch (params.notice) {
    case "revision-failed":
    case "off-topic":
      return { type: params.notice };
    case "unbuildable":
      return {
        type: "unbuildable",
        unmet: [params.unmet ?? []].flat(),
        missingSlots: [params.missingSlot ?? []].flat().filter(isSlot),
      };
    default:
      return null;
  }
}

function UserBar({ user }: { user: CurrentUser }) {
  return (
    <header className="flex items-center gap-3">
      {user.image && (
        // eslint-disable-next-line @next/next/no-img-element -- Google avatar URL
        <img src={user.image} alt="" className="h-10 w-10 rounded-full" />
      )}
      <span className="flex-1 font-medium">{user.name}</span>
      <a href="/settings" className="text-sm text-zinc-600 underline dark:text-zinc-400">
        설정
      </a>
      <form action={signOut}>
        <button type="submit" className="text-sm text-zinc-600 underline dark:text-zinc-400">
          로그아웃
        </button>
      </form>
    </header>
  );
}

function todayInKorea() {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}
