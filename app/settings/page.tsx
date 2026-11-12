import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getAccount } from "@/lib/account/server";
import { getCloset } from "@/lib/outfit/server";
import { signOutEverywhere } from "../actions";
import { PreferencesForm } from "../preferences-form";
import { RegionForm } from "../region-form";
import { CalendarSection } from "./calendar-section";
import { DeleteAccountSection } from "./delete-account";
import { TuningSection } from "./tuning-section";

export default function Settings({ searchParams }: PageProps<"/settings">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-10 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">설정</h1>
        <Link href="/home" className="text-sm text-zinc-600 underline dark:text-zinc-400">
          메인으로
        </Link>
      </div>
      <Suspense fallback={null}>
        <SettingsSections searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function SettingsSections({ searchParams }: Pick<PageProps<"/settings">, "searchParams">) {
  const { calendar } = await searchParams;
  const requestHeaders = await headers();
  const user = await getAccount().getCurrentUser(requestHeaders);
  if (!user) redirect("/?next=/settings");

  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">기본 지역</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          장소가 없는 일정은 이 지역의 날씨로 추천해요.
        </p>
        <RegionForm current={user.homeRegion} next="/settings" submitLabel="저장" />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">성별·선호 색상·스타일</h2>
        <PreferencesForm
          current={{
            ...(await getCloset().preferences(user.id)),
            gender: await getCloset().gender(user.id),
          }}
          next="/settings"
        />
      </section>
      <CalendarSection
        connection={user.calendarConnection}
        notice={typeof calendar === "string" ? calendar : undefined}
      />
      <TuningSection userId={user.id} />
      <LoginSection email={user.email} />
      <DeleteAccountSection />
    </>
  );
}

function LoginSection({ email }: { email: string }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">로그인</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{email}(으)로 로그인했어요.</p>
      <form action={signOutEverywhere}>
        <button type="submit" className="text-sm text-red-600 underline">
          모든 기기에서 로그아웃
        </button>
      </form>
    </section>
  );
}
