// Shown when Google stopped accepting the connection (expired or revoked).
export function ReconnectNotice({ returnTo }: { returnTo: "/home" | "/settings" }) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-md bg-amber-50 p-3 text-sm dark:bg-amber-950"
    >
      <p>캘린더 연동이 만료되었어요. 다시 연동하기 전까지는 일정 없이 추천해 드려요.</p>
      <a
        href={`/api/calendar/connect?returnTo=${returnTo}`}
        className="self-start font-medium underline"
      >
        다시 연동하기
      </a>
    </div>
  );
}
