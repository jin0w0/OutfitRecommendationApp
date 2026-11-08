// The real 캘린더 어댑터: the day's 일정 from Google Calendar (events.list),
// read-only, with the token and chosen calendars from the account module. Not
// tested automatically; check it by hand with a connected Google account.
import type { Account } from "@/lib/account/account";
import type { CalendarEvent, CalendarSource } from "./recommender";

const EVENTS_ENDPOINT = "https://www.googleapis.com/calendar/v3/calendars";
const TIME_ZONE = "Asia/Seoul";

type GoogleEventTime = { date?: string; dateTime?: string };

type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start: GoogleEventTime;
  end: GoogleEventTime;
};

export function createGoogleCalendarEvents(
  account: Pick<
    Account,
    "getCalendarAccessToken" | "getSelectedCalendarIds" | "markCalendarReconnectNeeded"
  >,
): CalendarSource {
  return {
    async status(userId) {
      const token = await account.getCalendarAccessToken(userId);
      if (token.status !== "ok") return token;
      return { status: "connected", calendarIds: await account.getSelectedCalendarIds(userId) };
    },

    async eventsOn({ userId, calendarId, date }) {
      const token = await account.getCalendarAccessToken(userId);
      if (token.status !== "ok") return null;
      const params = new URLSearchParams({
        // Every event overlapping the day in Korean time, 종일 일정 included.
        timeMin: `${date}T00:00:00+09:00`,
        timeMax: `${nextDay(date)}T00:00:00+09:00`,
        timeZone: TIME_ZONE,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "100",
      });
      const response = await fetch(
        `${EVENTS_ENDPOINT}/${encodeURIComponent(calendarId)}/events?${params}`,
        { headers: { authorization: `Bearer ${token.accessToken}` } },
      );
      if (response.status === 401) {
        await account.markCalendarReconnectNeeded(userId);
        return null;
      }
      if (!response.ok) throw new Error(`Google calendar events returned ${response.status}`);
      const body = (await response.json()) as { items?: GoogleEvent[] };
      return (body.items ?? [])
        .filter((event) => event.status !== "cancelled")
        .map((event) => toCalendarEvent(calendarId, event));
    },
  };
}

function toCalendarEvent(calendarId: string, event: GoogleEvent): CalendarEvent {
  const allDay = event.start.date !== undefined;
  return {
    id: event.id,
    calendarId,
    title: event.summary ?? "(제목 없음)",
    start: (allDay ? event.start.date : event.start.dateTime) ?? "",
    end: (allDay ? event.end.date : event.end.dateTime) ?? "",
    allDay,
    location: event.location?.trim() || null,
    description: event.description ?? null,
  };
}

function nextDay(date: string) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}
