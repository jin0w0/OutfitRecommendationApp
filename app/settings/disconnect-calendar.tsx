import { disconnectCalendar } from "../actions";

// Two steps: open the details to see what goes and what stays, then confirm.
export function DisconnectCalendar({ email }: { email: string }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <a href="/api/calendar/connect?returnTo=/settings" className="self-start underline">
        다른 구글 계정으로 바꾸기
      </a>
      <details>
        <summary className="cursor-pointer text-red-600">연동 해제</summary>
        <div className="mt-2 flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <p>{email}의 캘린더 연동을 해제할까요?</p>
          <ul className="list-disc pl-5 text-zinc-600 dark:text-zinc-400">
            <li>지워져요: 캘린더 접근 권한, 고른 캘린더, 일정에 대해 직접 고친 내용</li>
            <li>남아요: 착용 기록, 지금까지 받은 추천</li>
          </ul>
          <form action={disconnectCalendar}>
            <button type="submit" className="rounded-full bg-red-600 px-4 py-1.5 text-white">
              해제하기
            </button>
          </form>
        </div>
      </details>
    </div>
  );
}
