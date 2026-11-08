import { createTestAccount } from "@/lib/account/testing/harness";
import {
  createOutfitRecommender,
  type CalendarEvent,
  type CalendarSource,
  type CalendarStatus,
  type EventJudgement,
  type EventText,
  type LanguageModel,
  type Weather,
  type WeatherSource,
} from "../recommender";
import { createWardrobe, type NewClothing } from "../wardrobe";
import { createWearRecords } from "../wear-records";

// A recommender over a real 옷장 and 착용 기록 in an in-process Postgres, next
// to the account tables so clothes belong to real users. `today` is the date
// the recommender takes as today (YYYY-MM-DD).
export async function createTestOutfit({ today = "2026-11-10" }: { today?: string } = {}) {
  const { account, google, dialect, signInWithGoogle } = await createTestAccount();
  await account.migrate();
  const wardrobe = createWardrobe({ dialect });
  await wardrobe.migrate();
  const wearRecords = createWearRecords({ dialect });
  await wearRecords.migrate();
  const weather = new FakeWeather();
  const calendar = new FakeCalendar();
  const llm = new FakeLanguageModel();
  const recommender = createOutfitRecommender({
    wardrobe,
    weather,
    calendar,
    llm,
    wearRecords,
    today: () => today,
  });

  const signedIn = new Map<string, Headers>();

  async function createUser(email: string) {
    google.addAccount({ email, name: email });
    const { headers } = await signInWithGoogle(email);
    const user = await account.getCurrentUser(headers);
    signedIn.set(user!.id, headers);
    return user!.id;
  }

  // 탈퇴 for a user made with createUser.
  async function deleteAccount(userId: string) {
    await account.deleteAccount(signedIn.get(userId)!);
  }

  // Adds clothes to a user's 옷장, filling in unremarkable defaults.
  async function addClothes(userId: string, clothes: (Partial<NewClothing> & Pick<NewClothing, "name" | "slot">)[]) {
    const added = [];
    for (const clothing of clothes) {
      added.push(
        await wardrobe.addClothing(userId, {
          color: "black",
          seasons: ["spring", "summer", "autumn", "winter"],
          style: "casual",
          formality: "casual",
          warmth: 2,
          material: "cotton",
          ...clothing,
        }),
      );
    }
    return added;
  }

  return { wardrobe, weather, calendar, llm, recommender, createUser, deleteAccount, addClothes };
}

// Seoul, where the tests' users live.
export const SEOUL = { latitude: 37.5665, longitude: 126.978 };

// Forecasts set per date; any other date has no forecast (예보 없음).
class FakeWeather implements WeatherSource {
  private forecasts = new Map<string, Weather>();
  private failure: Error | null = null;
  requests: { date: string; latitude: number; longitude: number }[] = [];

  setForecast(date: string, weather: Weather) {
    this.forecasts.set(date, weather);
  }

  failWith(error = new Error("weather service is down")) {
    this.failure = error;
  }

  async forecast(request: { date: string; latitude: number; longitude: number }) {
    this.requests.push(request);
    if (this.failure) throw this.failure;
    return this.forecasts.get(request.date) ?? null;
  }
}

// Google Calendar for the tests' users. Nobody is connected until `connect`;
// each event belongs to one calendar and starts on one day.
class FakeCalendar implements CalendarSource {
  private connections = new Map<string, CalendarStatus>();
  private events: (CalendarEvent & { userId: string })[] = [];
  private failure: Error | null = null;
  private revoked = new Set<string>();
  private nextId = 1;
  eventRequests: { userId: string; calendarId: string; date: string }[] = [];

  // Connects the user with these calendars chosen.
  connect(userId: string, selectedCalendarIds: string[]) {
    this.connections.set(userId, { status: "connected", calendarIds: selectedCalendarIds });
  }

  // Google stopped accepting the user's connection (expired or revoked).
  expire(userId: string) {
    this.connections.set(userId, { status: "reconnect-needed" });
  }

  // Google refuses the token although the 연동 still looks connected, as when
  // the user revoked access from their Google account.
  revokeAtGoogle(userId: string) {
    this.revoked.add(userId);
  }

  failWith(error = new Error("Google Calendar is down")) {
    this.failure = error;
  }

  // `start` and `end` are YYYY-MM-DD for an all-day event, else ISO date-times.
  addEvent(
    userId: string,
    event: Pick<CalendarEvent, "calendarId" | "title" | "start" | "end"> & Partial<CalendarEvent>,
  ) {
    const added: CalendarEvent = {
      id: `event-${this.nextId++}`,
      allDay: !event.start.includes("T"),
      location: null,
      description: null,
      ...event,
    };
    this.events.push({ ...added, userId });
    return added;
  }

  async status(userId: string): Promise<CalendarStatus> {
    return this.connections.get(userId) ?? { status: "not-connected" };
  }

  async eventsOn(request: { userId: string; calendarId: string; date: string }) {
    this.eventRequests.push(request);
    if (this.failure) throw this.failure;
    if (this.revoked.has(request.userId)) return null;
    if (this.connections.get(request.userId)?.status !== "connected") return null;
    return this.events
      .filter((e) => e.userId === request.userId && e.calendarId === request.calendarId)
      .filter((e) => e.start.slice(0, 10) === request.date)
      .map(({ userId, ...event }) => (void userId, event));
  }
}

// The LLM, answering only what the test prepared: an 일정 whose title has no
// prepared judgement makes the whole call fail, as does `failWith`.
class FakeLanguageModel implements LanguageModel {
  private judgements = new Map<string, EventJudgement>();
  private failure: Error | null = null;
  // What each judgeEvents call was given.
  judgeRequests: EventText[][] = [];

  // 일정 titled `title` are judged as `judgement`.
  judge(title: string, judgement: EventJudgement) {
    this.judgements.set(title, judgement);
  }

  failWith(error = new Error("the LLM is down")) {
    this.failure = error;
  }

  async judgeEvents(events: EventText[]) {
    this.judgeRequests.push(events);
    if (this.failure) throw this.failure;
    return events.map(({ title }) => {
      const judgement = this.judgements.get(title);
      if (!judgement) throw new Error(`No judgement prepared for ${title}`);
      return judgement;
    });
  }
}
