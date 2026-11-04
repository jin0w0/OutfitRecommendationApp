import type { CurrentUser } from "@/lib/account/account";

const MESSAGES: Record<string, string> = {
  cancelled: "캘린더 연동을 취소했어요.",
  failed: "캘린더를 연동하지 못했어요. 학교·회사 계정은 관리자가 외부 앱 접근을 막아 두었을 수 있어요.",
};

export function CalendarSection({
  connection,
  notice,
}: {
  connection: CurrentUser["calendarConnection"];
  notice: string | undefined;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">캘린더 연동</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {connection
          ? `${connection.email}의 캘린더를 연동했어요.`
          : "구글 캘린더를 연동하면 일정에 맞는 코디를 추천받을 수 있어요. 일정은 읽기만 하고 수정하지 않아요."}
      </p>
      {notice && MESSAGES[notice] && (
        <p role="alert" className="text-sm text-red-600">
          {MESSAGES[notice]}
        </p>
      )}
      {!connection && (
        // A plain link: the route redirects the browser to Google.
        <a
          href="/api/calendar/connect?returnTo=/settings"
          className="self-start rounded-full bg-foreground px-5 py-2 text-sm text-background"
        >
          구글 캘린더 연동하기
        </a>
      )}
    </section>
  );
}
