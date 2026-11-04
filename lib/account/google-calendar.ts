// Google Calendar API calls the account module needs for 캘린더 연동.

const CALENDAR_LIST_ENDPOINT = "https://www.googleapis.com/calendar/v3/users/me/calendarList";

export type GoogleCalendar = { id: string; name: string; primary: boolean };

// null means Google no longer accepts the token (access was revoked).
export async function listGoogleCalendars(accessToken: string): Promise<GoogleCalendar[] | null> {
  const response = await fetch(CALENDAR_LIST_ENDPOINT, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`Google calendar list returned ${response.status}`);
  const body = (await response.json()) as {
    items: { id: string; summary: string; summaryOverride?: string; primary?: boolean }[];
  };
  return body.items.map((item) => ({
    id: item.id,
    name: item.summaryOverride ?? item.summary,
    primary: item.primary === true,
  }));
}
