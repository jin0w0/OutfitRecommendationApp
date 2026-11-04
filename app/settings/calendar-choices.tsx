import { headers } from "next/headers";
import { getAccount } from "@/lib/account/server";
import { saveCalendarSelection } from "../actions";

// The connected account's calendars, read live from Google.
export async function CalendarChoices() {
  const requestHeaders = await headers();
  const calendars = await getAccount().listCalendars(requestHeaders);

  return (
    <form action={saveCalendarSelection} className="flex flex-col gap-2">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">일정을 불러올 캘린더를 골라 주세요.</p>
      {calendars.map((calendar) => (
        <label key={calendar.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="calendar"
            value={calendar.id}
            defaultChecked={calendar.selected}
          />
          {calendar.name}
          {calendar.primary && <span className="text-zinc-500">(기본)</span>}
        </label>
      ))}
      <button type="submit" className="self-start text-sm underline">
        저장
      </button>
    </form>
  );
}
