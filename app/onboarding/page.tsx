import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getAccount } from "@/lib/account/server";
import { skipCalendarInvite } from "../actions";
import { PreferencesForm } from "../preferences-form";
import { RegionForm } from "../region-form";

export default function Onboarding() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      <Suspense fallback={<div className="h-40" />}>
        <OnboardingStep />
      </Suspense>
    </main>
  );
}

// 기본 지역 first, then the one-time 선호 단계 and 캘린더 연동 권유, then the main screen.
async function OnboardingStep() {
  const requestHeaders = await headers();
  const user = await getAccount().getCurrentUser(requestHeaders);
  if (!user) redirect("/?next=/onboarding");
  if (user.needsOnboarding) return <HomeRegionStep />;
  if (user.shouldAskPreferences) return <PreferencesStep />;
  if (user.shouldInviteCalendar) return <CalendarInviteStep />;
  redirect("/home");
}

function PreferencesStep() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">어떤 색과 스타일을 좋아하세요?</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          고른 색과 스타일이 들어간 코디를 더 추천해 드려요. 나중에 설정에서 바꿀 수 있어요.
        </p>
      </div>
      <PreferencesForm current={{ colors: [], styles: [], gender: null }} next="/onboarding" />
    </>
  );
}

function HomeRegionStep() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">어디에서 주로 생활하세요?</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          장소가 정해지지 않은 일정은 이 지역의 날씨로 코디를 추천해 드려요. 나중에 설정에서
          바꿀 수 있어요.
        </p>
      </div>
      <RegionForm current={null} next="/onboarding" submitLabel="다음" />
    </>
  );
}

function CalendarInviteStep() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">구글 캘린더를 연동할까요?</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          일정의 종류와 격식에 맞춰 그날의 코디를 추천해 드려요. 학교 계정처럼 로그인한 계정과
          다른 구글 계정의 캘린더도 연동할 수 있어요.
        </p>
        <ul className="list-disc pl-5 text-sm text-zinc-600 dark:text-zinc-400">
          <li>일정의 제목, 시간, 장소만 읽어요.</li>
          <li>일정을 만들거나 고치거나 지우지 않아요.</li>
          <li>설정에서 언제든 연동을 해제할 수 있어요.</li>
        </ul>
      </div>
      <div className="flex items-center gap-4">
        <a
          href="/api/calendar/connect?returnTo=/home"
          className="rounded-full bg-foreground px-5 py-2 text-background"
        >
          연동하기
        </a>
        <form action={skipCalendarInvite}>
          <button type="submit" className="text-sm text-zinc-600 underline dark:text-zinc-400">
            건너뛰기
          </button>
        </form>
      </div>
    </>
  );
}
