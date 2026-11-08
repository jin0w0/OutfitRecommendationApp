// The 코디 추천 module's ports: what it needs from the calendar, the weather
// and the LLM, as the adapters (real and fake) implement them.
import type { EventKind } from "./situations";
import type { Clothing, Formality } from "./wardrobe";
import type { Evidence } from "./scoring";
import type { RevisionCondition } from "./revision";

export type Coordinates = { latitude: number; longitude: number };

// The day's weather: its representative 기온 in °C and whether it rains.
export type Weather = { temperature: number; rain: boolean };

// The 날씨 어댑터. Resolves to null when there is no forecast for the date
// (예보 없음), and rejects when the forecast could not be fetched.
export type WeatherSource = {
  forecast(request: { date: string } & Coordinates): Promise<Weather | null>;
};

// One 일정 from the user's calendar.
export type CalendarEvent = {
  id: string;
  calendarId: string;
  title: string;
  // YYYY-MM-DD for an 종일 일정 (end exclusive), else ISO date-times.
  start: string;
  end: string;
  allDay: boolean;
  // The 장소 as typed into the calendar, if any.
  location: string | null;
  // The 메모.
  description: string | null;
};

// How the user's 캘린더 연동 stands, with the calendars they chose to use.
export type CalendarStatus =
  | { status: "not-connected" }
  | { status: "reconnect-needed" }
  | { status: "connected"; calendarIds: string[] };

// The 캘린더 어댑터, read-only.
export type CalendarSource = {
  status(userId: string): Promise<CalendarStatus>;
  // The 일정 on `date` (Korean time) in one calendar, 종일 일정 included.
  // Resolves to null once Google stops accepting the connection (expired or
  // revoked), and rejects when the calendar could not be read otherwise.
  eventsOn(request: { userId: string; calendarId: string; date: string }): Promise<
    CalendarEvent[] | null
  >;
};

// What the LLM is told about one 일정: only what judging it needs. Never its
// 참석자, id or time.
export type EventText = { title: string; description: string | null; location: string | null };

// The 일정의 종류 and 격식 수준 judged for one 일정.
export type EventJudgement = { kind: EventKind; formality: Formality };

// The LLM 어댑터. Every method takes and returns structured data, and rejects
// when the LLM could not answer.
export type LanguageModel = {
  // One judgement per 일정, in the same order.
  judgeEvents(events: EventText[]): Promise<EventJudgement[]>;
  // One short sentence per 근거, in the same order, saying only what the
  // 근거 holds.
  writeReasons(evidence: Evidence[]): Promise<string[]>;
  // The 수정 조건 a 대화 message asks for, in the order asked. `outfit` is the
  // 코디 the user is looking at and `wardrobe` their whole 옷장, so that
  // conditions can name pieces ("이 바지") by clothing id.
  interpretRevision(request: RevisionRequest): Promise<AskedCondition[]>;
};

export type RevisionRequest = { message: string; outfit: Clothing[]; wardrobe: Clothing[] };

// A 수정 조건 as the LLM answers it, naming pieces by clothing id, or
// off-topic for a message that has nothing to do with the 코디 (무관한 메시지).
export type AskedCondition =
  | Extract<RevisionCondition, { type: "style" | "color" }>
  | { type: "exclude" | "keep"; clothingId: string }
  | { type: "off-topic" };
