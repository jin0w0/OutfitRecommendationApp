// The 코디 추천 module. Callers see only its entry points; everything that goes
// into choosing a 코디 happens inside.
import { regionOfPlace } from "./places";
import { EVENT_KINDS, type EventKind } from "./situations";
import { templateSentence } from "./reasons";
import type { Clothing, Formality, Material, Preferences, Slot, Style, Wardrobe } from "./wardrobe";
import type { EventCorrections } from "./event-corrections";
import type { WearRecords, WearStatus } from "./wear-records";
import type { RecommendationSessions } from "./recommendation-sessions";

export type Outfit = {
  top?: Clothing;
  bottom?: Clothing;
  dress?: Clothing;
  shoes: Clothing;
  outer?: Clothing;
};

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

// One 수정 조건 asked for in 대화로 수정하기.
//   style: a 격식 수준 one level below (casual) or above (formal) the one the
//     코디 was first chosen at
//   color: lighter or darker colors, where the 옷장 has them
//   exclude: never this piece
//   keep: always this piece (아이템 고정)
export type RevisionCondition =
  | { type: "style"; direction: StyleDirection }
  | { type: "color"; direction: ColorDirection }
  | { type: "exclude"; clothing: Clothing }
  | { type: "keep"; clothing: Clothing };

// A 수정 조건 as the LLM answers it, naming pieces by clothing id.
export type AskedCondition =
  | Extract<RevisionCondition, { type: "style" | "color" }>
  | { type: "exclude" | "keep"; clothingId: string };

export type StyleDirection = "casual" | "formal";
export type ColorDirection = "lighter" | "darker";

// One slot of the 코디 that a 수정 changed: what it held before and after
// (null for none), and the 수정 조건 that made the change, or null when it
// changed only to go with the rest of the 코디.
export type OutfitChange = {
  slot: keyof Outfit;
  from: Clothing | null;
  to: Clothing | null;
  cause: RevisionCondition | null;
};

// What makes a 추천 결과 a 수정 결과: the message, every 수정 조건 asked for
// in the session so far (a later one replacing any it conflicts with), and how
// the 코디 differs from the one before.
export type Revision = { message: string; conditions: RevisionCondition[]; changes: OutfitChange[] };

// One of the day's 일정 with what was judged of it, or null when it could not
// be judged.
export type DayEvent = CalendarEvent & { judgement: EventJudgement | null };

// Information the recommendation had to go without.
//   no-forecast: the date is outside the forecast range (날씨 미반영)
//   weather-failed: the 날씨 어댑터 failed
//   calendar-reconnect-needed: the 캘린더 연동 expired or was revoked, so the
//     user should see the 재연동 안내
//   calendar-failed: the 캘린더 어댑터 failed otherwise
//   llm-failed: the LLM could not judge the day's 일정, so the 코디 follows
//     the situation the user picked, or none
//   reasons-llm-failed: the LLM could not write the 추천 이유, so they are
//     plain sentences made from the 근거
//   revision-llm-failed: the LLM could not read the 대화 message, so the
//     코디 is the one before it, unchanged
export type MissingInfo =
  | "no-forecast"
  | "weather-failed"
  | "calendar-reconnect-needed"
  | "calendar-failed"
  | "llm-failed"
  | "reasons-llm-failed"
  | "revision-llm-failed";

// The 일정 the 코디 is chosen for: its 일정의 종류 and 격식 수준.
export type Basis = EventJudgement;

// 0..1 per factor. A factor that did not apply (e.g. 일정 with 일정 없음) is absent.
// `recency` is low for clothes worn in the last few days (최근 착용 기록);
// `utilization` is high for clothes not worn in a long time (활용도).
export type Scores = {
  weather?: number;
  event?: number;
  color: number;
  style: number;
  preference: number;
  recency: number;
  utilization: number;
};

export type Factor = keyof Scores;

// The 근거 behind one 추천 이유: a factor of the score, the pieces of the 코디
// it is about, and the facts that made them score well. It comes only from
// the scoring.
export type Evidence =
  // The day's weather, and the pieces that suit it (any 아우터 among them).
  | { factor: "weather"; clothes: Clothing[]; facts: Weather }
  // The 기준 일정 (or picked situation, untitled), and the pieces at the 격식 수준 the
  // 코디 was chosen at: the 일정's, or the one 대화로 수정하기 asked for.
  | { factor: "event"; clothes: Clothing[]; facts: Basis & { title: string | null } }
  // Every color of the 코디, and those of them that are not neutral.
  | { factor: "color"; clothes: Clothing[]; facts: { colors: string[]; accents: string[] } }
  // The style most of the 코디 shares, and the pieces in it.
  | { factor: "style"; clothes: Clothing[]; facts: { style: Style } }
  // The user's preferred colors and styles that the pieces match.
  | { factor: "preference"; clothes: Clothing[]; facts: { colors: string[]; styles: Style[] } }
  // The pieces not worn in the last `days` days.
  | { factor: "recency"; clothes: Clothing[]; facts: { days: number } }
  // The pieces not worn for at least `days` days, or never.
  | { factor: "utilization"; clothes: Clothing[]; facts: { days: number } };

// One 추천 이유: its 근거, and the 근거 as a sentence for the user.
export type Reason = { evidence: Evidence; sentence: string };

// How many 추천 이유 a 코디 comes with, at most.
const MAX_REASONS = 3;

// The same defaults for every user for now.
const WEIGHTS: Required<Scores> = {
  weather: 3,
  event: 3,
  color: 2,
  style: 1,
  preference: 2,
  recency: 2,
  utilization: 1,
};

// Clothes worn within this many days count as recently worn.
const RECENT_DAYS = 7;
// Clothes not worn for this many days, or never, get the full 활용도 score.
const LONG_UNWORN_DAYS = 30;

// 소재 that rain ruins.
const RAIN_WEAK_MATERIALS = new Set<Material>(["suede", "canvas"]);

// Colors that go with anything; a 코디 reads well with at most one other.
const NEUTRAL_COLORS = new Set(["black", "white", "gray", "navy", "beige", "brown"]);

type RecommendationContext = {
  date: string;
  // The day's 일정 from the calendars the user chose, in the order they happen.
  events: DayEvent[];
  // The 기준 일정 the 코디 is chosen for: the most formal of the day's 일정
  // (the earliest of equals), or the first when they could not be judged.
  // Null without any 일정.
  baseEvent: DayEvent | null;
  basis: Basis | null;
  // The weather the 코디 was chosen for, or null when it was not 반영.
  weather: Weather | null;
  // The region named by the 기준 일정's 장소 that the weather is for, or null
  // when it is for the given location (the 기본 지역).
  weatherPlace: string | null;
  missing: MissingInfo[];
  accepted: Accepted;
};

// What the day is, as 날짜로 추천받기 found it. Every 수정 in the session is
// for the same day.
type Day = Omit<RecommendationContext, "accepted">;

// A 추천 세션 step as stored: the 추천 결과, which is a 수정 결과 unless
// `revision` is null (날짜로 추천받기's).
type Step = Chosen & { revision: Revision | null };

// The day of a session's first step, as stored. The 기준 일정 is the one among
// the day's 일정 again, as 날짜로 추천받기 returned it.
function dayOf(first: Step): Day {
  const { date, events, baseEvent, basis, weather, weatherPlace } = first;
  return {
    date,
    events,
    baseEvent: baseEvent && (events.find((e) => e.calendarId === baseEvent.calendarId && e.id === baseEvent.id) ?? null),
    basis,
    weather,
    weatherPlace,
    missing: first.missing.filter((m) => DAY_MISSING.includes(m)),
  };
}

// The MissingInfo that is about the day rather than one 코디.
const DAY_MISSING: MissingInfo[] = [
  "no-forecast",
  "weather-failed",
  "calendar-reconnect-needed",
  "calendar-failed",
  "llm-failed",
];

// The 코디 the user already accepted ("입을게요") for the date, if any.
// Clothes since removed from the 옷장 are left out.
export type Accepted = { status: WearStatus; clothes: Clothing[] } | null;

// The 코디 chosen for the day, or why there is none.
type Chosen = RecommendationContext &
  (
    // `reasons`: the 추천 이유, from the factors that added most to the score.
    | { status: "ok"; outfit: Outfit; scores: Scores; reasons: Reason[] }
    // The 옷장 has nothing to fill these slots with.
    | { status: "unbuildable"; missingSlots: Slot[] }
  );

export type Recommendation = Step & {
  // The 추천 세션 this result is a step of, for 대화로 수정하기.
  sessionId: string;
};

// How much of the 일정 score a piece loses when it is two 격식 수준 off every
// other 일정 of the day. Less than a level's worth, so the 기준 일정 comes first.
const OTHER_EVENT_PENALTY = 0.25;

// Below this 기온 (°C) the 코디 gets an 아우터.
const OUTER_BELOW = 17;

const FORMALITY_LEVEL: Record<Formality, number> = { casual: 0, "semi-formal": 1, formal: 2 };

export function createOutfitRecommender({
  wardrobe,
  weather: weatherSource,
  calendar,
  llm,
  wearRecords,
  eventCorrections,
  sessions,
  today = todayInKorea,
}: {
  wardrobe: Pick<Wardrobe, "clothes" | "preferences">;
  weather: WeatherSource;
  calendar: CalendarSource;
  llm: LanguageModel;
  wearRecords: WearRecords;
  eventCorrections: EventCorrections;
  sessions: RecommendationSessions;
  // YYYY-MM-DD. Dates up to today are worn when accepted; later ones are plans.
  today?: () => string;
}) {
  // The day's 일정 from the calendars the user chose, in the order they happen,
  // or why there are none to go by. A user without 캘린더 연동 is not a failure.
  async function dayEvents(
    userId: string,
    date: string,
  ): Promise<{ events: CalendarEvent[]; failure?: MissingInfo }> {
    try {
      const connection = await calendar.status(userId);
      if (connection.status === "not-connected") return { events: [] };
      if (connection.status === "reconnect-needed") {
        return { events: [], failure: "calendar-reconnect-needed" };
      }
      const perCalendar = await Promise.all(
        connection.calendarIds.map((calendarId) => calendar.eventsOn({ userId, calendarId, date })),
      );
      if (perCalendar.includes(null)) return { events: [], failure: "calendar-reconnect-needed" };
      return { events: perCalendar.flatMap((events) => events ?? []).sort(byStart) };
    } catch {
      return { events: [], failure: "calendar-failed" };
    }
  }

  // The day's 일정, each with its 일정의 종류 and 격식 수준 as the user
  // corrected them or, for the rest, as the LLM judged them. Only uncorrected
  // 일정 go to the LLM; they stay unjudged when it could not answer.
  async function judged(
    userId: string,
    events: CalendarEvent[],
  ): Promise<{ events: DayEvent[]; failed: boolean }> {
    if (!events.length) return { events: [], failed: false };
    const corrections = await eventCorrections.forEvents(
      userId,
      events.map((event) => event.id),
    );
    const toJudge = events.filter((event) => !corrections.has(event.id));
    let judgements: EventJudgement[] | null = [];
    if (toJudge.length) {
      try {
        judgements = await llm.judgeEvents(
          toJudge.map(({ title, description, location }) => ({ title, description, location })),
        );
        if (judgements.length !== toJudge.length) throw new Error("A judgement per 일정 was expected");
      } catch {
        judgements = null;
      }
    }
    const judgedById = new Map(toJudge.map((event, i) => [event.id, judgements?.[i] ?? null]));
    return {
      events: events.map((event) => ({
        ...event,
        judgement: corrections.get(event.id) ?? judgedById.get(event.id) ?? null,
      })),
      failed: judgements === null,
    };
  }

  return {
    // 날짜로 추천받기. The 코디 is chosen for the 기준 일정 among the day's
    // 일정. Without any judged 일정 it is chosen for `situation`, the 일정 the
    // user picked, or for 일정 없음 when that is null.
    // For 다시 추천받기, `shown` lists the 코디 (as clothing ids) already shown
    // for this date; the best other 코디 is chosen when the 옷장 has one.
    async recommendForDate({
      userId,
      date,
      situation,
      location,
      shown = [],
    }: {
      userId: string;
      // YYYY-MM-DD
      date: string;
      situation: EventKind | null;
      // Where the 코디 is worn: the user's 기본 지역 for now.
      location: Coordinates;
      shown?: string[][];
    }): Promise<Recommendation> {
      const missing: MissingInfo[] = [];
      const calendarDay = await dayEvents(userId, date);
      if (calendarDay.failure) missing.push(calendarDay.failure);
      const { events, failed } = await judged(userId, calendarDay.events);
      if (failed) missing.push("llm-failed");
      const baseEvent = mostFormal(events) ?? events[0] ?? null;
      const basis =
        baseEvent?.judgement ??
        (situation && { kind: situation, formality: EVENT_KINDS[situation].formality });

      // The 기준 일정's 장소 when it names a known place, else the 기본 지역.
      const place = baseEvent?.location ? regionOfPlace(baseEvent.location) : null;
      const { latitude, longitude } = place ?? location;
      let weather: Weather | null = null;
      try {
        weather = await weatherSource.forecast({ date, latitude, longitude });
        if (!weather) missing.push("no-forecast");
      } catch {
        missing.push("weather-failed");
      }
      const day: Day = { date, events, baseEvent, basis, weather, weatherPlace: place?.name ?? null, missing };
      const step = await recommend(userId, day, await wardrobe.clothes(userId), {
        formality: basis?.formality ?? null,
        conditions: [],
        shown,
      });
      const sessionId = await sessions.start<Step>(userId, date, { ...step, revision: null });
      return { ...step, sessionId, revision: null };
    },

    // 대화로 수정하기: the 코디 of the session's latest step, changed as
    // `message` asks on top of what was asked before. The LLM only turns the
    // message into 수정 조건; the 코디 is chosen and explained as in
    // 날짜로 추천받기, for the same day.
    async revise({
      userId,
      sessionId,
      message,
    }: {
      userId: string;
      sessionId: string;
      message: string;
    }): Promise<Recommendation> {
      const session = await sessions.get<Step>(userId, sessionId);
      if (!session) throw new Error("No such 추천 세션");
      const first = session.steps[0];
      const last = session.steps.at(-1)!;
      const wardrobeClothes = await wardrobe.clothes(userId);
      let asked: RevisionCondition[];
      try {
        asked = resolved(
          await llm.interpretRevision({
            message,
            outfit: last.status === "ok" ? Object.values(last.outfit) : [],
            wardrobe: wardrobeClothes,
          }),
          wardrobeClothes,
        );
      } catch {
        return { ...last, sessionId, missing: [...last.missing, "revision-llm-failed"] };
      }
      const conditions = accumulate(last.revision?.conditions ?? [], asked);
      const step = await recommend(userId, dayOf(first), wardrobeClothes, {
        formality: shifted(anchorFormality(first), conditions),
        conditions,
        shown: [],
      });
      const revision: Revision = { message, conditions, changes: changesBetween(last, step, conditions) };
      await sessions.saveSteps<Step>(userId, sessionId, [...session.steps, { ...step, revision }]);
      return { ...step, sessionId, revision };
    },

    // The 추천 결과 of the session's latest step as it was returned, with the
    // 코디 accepted for the date now. Null when the session is not the user's
    // or a later 날짜로 추천받기 replaced it.
    async latest({ userId, sessionId }: { userId: string; sessionId: string }): Promise<Recommendation | null> {
      const session = await sessions.get<Step>(userId, sessionId);
      if (!session) return null;
      const last = session.steps.at(-1)!;
      return { ...last, sessionId, accepted: await acceptedOn(userId, last.date, await wardrobe.clothes(userId)) };
    },

    // "입을게요": the user will wear these clothes on `date`. Replaces any 코디
    // already accepted for that date. Only clothes from the user's 옷장.
    async accept({ userId, date, clothingIds }: { userId: string; date: string; clothingIds: string[] }) {
      const owned = new Set((await wardrobe.clothes(userId)).map((c) => c.id));
      if (!clothingIds.length || !clothingIds.every((id) => owned.has(id))) {
        throw new Error("Only clothes from the user's 옷장 can be accepted");
      }
      const status: WearStatus = date <= today() ? "worn" : "planned";
      await wearRecords.save(userId, { date, status, clothingIds });
    },

    // 일정 판단 직접 고치기: from now on the user's 일정 `eventId` (a calendar
    // 일정 식별자) is taken to be `judgement`, whatever the LLM would say.
    async correctEvent({
      userId,
      eventId,
      judgement,
    }: {
      userId: string;
      eventId: string;
      judgement: EventJudgement;
    }) {
      await eventCorrections.save(userId, eventId, judgement);
    },

    // 수락 취소: forgets the 착용 기록 or plan for `date`.
    async cancelAcceptance({ userId, date }: { userId: string; date: string }) {
      await wearRecords.remove(userId, date);
    },
  };

  // The best 코디 for the day from `wardrobeClothes`, chosen at `formality`
  // under the 수정 조건, and explained. Both entry points choose through this.
  async function recommend(
    userId: string,
    day: Day,
    wardrobeClothes: Clothing[],
    {
      formality,
      conditions,
      shown,
    }: { formality: Formality | null; conditions: RevisionCondition[]; shown: string[][] },
  ): Promise<Chosen> {
    const missing = [...day.missing];
    const context = { ...day, missing, accepted: await acceptedOn(userId, day.date, wardrobeClothes) };
    const scoring = await scoringFacts(userId, day, formality);
    const kept = wardrobeClothes.filter((c) =>
      conditions.some((condition) => condition.type === "keep" && condition.clothing.id === c.id),
    );
    const clothes = conditioned(wardrobeClothes, formality, conditions);
    const needsOuter =
      (day.weather !== null && day.weather.temperature < OUTER_BELOW) || kept.some((c) => c.slot === "outer");
    const candidates = candidateOutfits(clothes, needsOuter).filter((outfit) =>
      kept.every((c) => Object.values(outfit).includes(c)),
    );
    const shownKeys = new Set(shown.map((ids) => [...ids].sort().join()));
    const unshown = candidates.filter((outfit) => !shownKeys.has(outfitKey(outfit)));
    const best = maxBy(
      (unshown.length ? unshown : candidates).map((outfit) => ({
        outfit,
        scores: score(outfit, scoring),
      })),
      ({ scores }) => total(scores),
    );
    if (!best) {
      return { status: "unbuildable", ...context, missingSlots: missingSlots(clothes) };
    }
    const { reasons, failed } = await explain(best.outfit, best.scores, scoring);
    if (failed) missing.push("reasons-llm-failed");
    return { status: "ok", ...context, ...best, reasons };
  }

  async function acceptedOn(userId: string, date: string, wardrobeClothes: Clothing[]): Promise<Accepted> {
    const record = await wearRecords.onDate(userId, date);
    return record
      ? {
          status: record.status,
          clothes: record.clothingIds.flatMap((id) => wardrobeClothes.filter((c) => c.id === id)),
        }
      : null;
  }

  // What every 코디 for the day is scored against, with clothes wanted at
  // `formality`.
  async function scoringFacts(userId: string, day: Day, formality: Formality | null): Promise<ScoringFacts> {
    const { events, baseEvent, basis, weather, date } = day;
    return {
      basis,
      formality,
      basisTitle: baseEvent?.judgement ? baseEvent.title : null,
      // The 격식 수준 of the day's judged 일정 other than the 기준 일정.
      otherFormalities: events.flatMap((event) =>
        event !== baseEvent && event.judgement ? [event.judgement.formality] : [],
      ),
      weather,
      preferences: await wardrobe.preferences(userId),
      daysSinceWorn: await daysSinceLastWorn(userId, date),
    };
  }

  // The 추천 이유 for a scored 코디: the 근거 of the factors that added most
  // to its score, put into sentences by the LLM, or by template when it
  // fails. Every 코디 the module returns goes through this.
  async function explain(
    outfit: Outfit,
    scores: Scores,
    scoring: ScoringFacts,
  ): Promise<{ reasons: Reason[]; failed: boolean }> {
    const evidence = topEvidence(outfit, scores, scoring);
    if (!evidence.length) return { reasons: [], failed: false };
    try {
      const sentences = await llm.writeReasons(evidence);
      if (sentences.length !== evidence.length || sentences.some((s) => !s.trim())) {
        throw new Error("A sentence per 근거 was expected");
      }
      return { reasons: evidence.map((e, i) => ({ evidence: e, sentence: sentences[i] })), failed: false };
    } catch {
      return { reasons: evidence.map((e) => ({ evidence: e, sentence: templateSentence(e) })), failed: true };
    }
  }

  // Per clothing id, days from its latest 착용 기록 before `date` to `date`.
  // Plans never count.
  async function daysSinceLastWorn(userId: string, date: string) {
    const days = new Map<string, number>();
    for (const record of await wearRecords.wornBefore(userId, date)) {
      for (const id of record.clothingIds) {
        if (!days.has(id)) days.set(id, daysBetween(record.date, date));
      }
    }
    return days;
  }
}

function outfitKey(outfit: Outfit) {
  return Object.values(outfit)
    .map((c) => c.id)
    .sort()
    .join();
}

function daysBetween(from: string, to: string) {
  return (Date.parse(to) - Date.parse(from)) / 86_400_000;
}

function todayInKorea() {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

// 종일 일정 first, then by start time.
function byStart(a: CalendarEvent, b: CalendarEvent) {
  const key = (e: CalendarEvent) => (e.allDay ? -Infinity : Date.parse(e.start));
  return key(a) - key(b) || 0;
}

// The judged 일정 with the highest 격식 수준, the earliest of equals.
function mostFormal(events: DayEvent[]) {
  let best: DayEvent | undefined;
  for (const event of events) {
    if (!event.judgement) continue;
    const level = FORMALITY_LEVEL[event.judgement.formality];
    if (!best || level > FORMALITY_LEVEL[best.judgement!.formality]) best = event;
  }
  return best;
}

// Per slot, the clothes that match the 격식 수준, falling back to those one
// level off. Clothes two levels off are never worn at it.
function suitableClothes(clothes: Clothing[], formality: Formality | null) {
  if (!formality) return clothes;
  const distance = (c: Clothing) =>
    Math.abs(FORMALITY_LEVEL[c.formality] - FORMALITY_LEVEL[formality]);
  const suitable: Clothing[] = [];
  for (const slot of new Set(clothes.map((c) => c.slot))) {
    const inSlot = clothes.filter((c) => c.slot === slot);
    const exact = inSlot.filter((c) => distance(c) === 0);
    suitable.push(...(exact.length ? exact : inSlot.filter((c) => distance(c) === 1)));
  }
  return suitable;
}

// Colors read as light or dark for the 색상 방향 of 대화로 수정하기. Others
// count as neither.
const LIGHT_COLORS = new Set(["white", "beige", "yellow", "pink", "orange", "ivory", "sky"]);
const DARK_COLORS = new Set(["black", "navy", "brown", "gray", "khaki", "purple", "charcoal"]);

function hasColorDirection(color: string, direction: ColorDirection) {
  return (direction === "lighter" ? LIGHT_COLORS : DARK_COLORS).has(color);
}

// The clothes a 코디 may be made of under the 수정 조건: none that is
// excluded; per slot, those at the 격식 수준 and in the 색상 방향 where the
// slot has any; and every kept piece, whatever else is asked.
function conditioned(clothes: Clothing[], formality: Formality | null, conditions: RevisionCondition[]) {
  const excluded = new Set(conditions.flatMap((c) => (c.type === "exclude" ? [c.clothing.id] : [])));
  const keptIds = new Set(conditions.flatMap((c) => (c.type === "keep" ? [c.clothing.id] : [])));
  const color = conditions.find((c) => c.type === "color");
  const kept = clothes.filter((c) => keptIds.has(c.id));
  let pool = suitableClothes(
    clothes.filter((c) => !excluded.has(c.id) && !keptIds.has(c.id)),
    formality,
  );
  if (color) {
    pool = [...new Set(pool.map((c) => c.slot))].flatMap((slot) => {
      const inSlot = pool.filter((c) => c.slot === slot);
      const matching = inSlot.filter((c) => hasColorDirection(c.color, color.direction));
      return matching.length ? matching : inSlot;
    });
  }
  return [...kept, ...pool];
}

// The 수정 조건 the LLM answered, with the pieces they name from the 옷장.
// Conditions naming a piece the 옷장 does not have are dropped.
function resolved(asked: AskedCondition[], wardrobe: Clothing[]): RevisionCondition[] {
  return asked.flatMap((c): RevisionCondition[] => {
    if (c.type === "style" || c.type === "color") return [c];
    const clothing = wardrobe.find(({ id }) => id === c.clothingId);
    return clothing ? [{ type: c.type, clothing }] : [];
  });
}

// The 수정 조건 so far with `asked` added after them. A new condition replaces
// any earlier one it conflicts with: another 스타일 방향 or 색상 방향, any
// condition on the same piece, or keeping another piece for the same slot.
function accumulate(earlier: RevisionCondition[], asked: RevisionCondition[]) {
  const clash = (a: RevisionCondition, b: RevisionCondition) => {
    if (a.type === "style" || a.type === "color") return a.type === b.type;
    if (b.type === "style" || b.type === "color") return false;
    if (a.clothing.id === b.clothing.id) return true;
    if (a.type !== "keep" || b.type !== "keep") return false;
    const slots = new Set([a.clothing.slot, b.clothing.slot]);
    return slots.size === 1 || (slots.has("dress") && (slots.has("top") || slots.has("bottom")));
  };
  let conditions = earlier;
  for (const condition of asked) {
    conditions = [...conditions.filter((c) => !clash(c, condition)), condition];
  }
  return conditions;
}

// The 격식 수준 the session's first 코디 was chosen at: its 기준 일정's, or,
// without one, the one most of that 코디 has.
function anchorFormality(first: Step): Formality | null {
  if (first.basis) return first.basis.formality;
  if (first.status !== "ok") return null;
  const counts = new Map<Formality, number>();
  for (const { formality } of Object.values(first.outfit)) counts.set(formality, (counts.get(formality) ?? 0) + 1);
  return maxBy([...counts], ([, count]) => count)![0];
}

// `formality` one level toward the 스타일 방향 asked for, if any.
function shifted(formality: Formality | null, conditions: RevisionCondition[]): Formality | null {
  const style = conditions.find((c) => c.type === "style");
  if (!formality || !style) return formality;
  const level = FORMALITY_LEVEL[formality] + (style.direction === "casual" ? -1 : 1);
  const levels = Object.keys(FORMALITY_LEVEL) as Formality[];
  return levels[Math.min(Math.max(level, 0), levels.length - 1)];
}

const SLOTS: (keyof Outfit)[] = ["outer", "top", "bottom", "dress", "shoes"];

// The slots whose piece differs between two steps, each with the 수정 조건
// behind the change, the latest asked first.
function changesBetween(before: Chosen, after: Chosen, conditions: RevisionCondition[]) {
  if (before.status !== "ok" || after.status !== "ok") return [];
  const changes: OutfitChange[] = [];
  for (const slot of SLOTS) {
    const from = before.outfit[slot] ?? null;
    const to = after.outfit[slot] ?? null;
    if (from?.id === to?.id) continue;
    const cause =
      [...conditions].reverse().find((c) => {
        switch (c.type) {
          case "exclude":
            return from?.id === c.clothing.id;
          case "keep":
            return to?.id === c.clothing.id;
          case "style": {
            if (!from || !to) return false;
            const delta = FORMALITY_LEVEL[to.formality] - FORMALITY_LEVEL[from.formality];
            return c.direction === "casual" ? delta < 0 : delta > 0;
          }
          case "color":
            return !!to && hasColorDirection(to.color, c.direction) && !(from && hasColorDirection(from.color, c.direction));
        }
      }) ?? null;
    changes.push({ slot, from, to, cause });
  }
  return changes;
}

// What a 코디 is scored against.
type ScoringFacts = {
  basis: Basis | null;
  // The 격식 수준 the clothes should have: the basis's, or the one 대화로
  // 수정하기 asked for instead.
  formality: Formality | null;
  // The 기준 일정's title when the basis is its judgement, else null.
  basisTitle: string | null;
  // The 격식 수준 of the day's judged 일정 other than the 기준 일정.
  otherFormalities: Formality[];
  weather: Weather | null;
  preferences: Preferences;
  // Per clothing id, days since its latest 착용 기록. Absent if never worn.
  daysSinceWorn: Map<string, number>;
};

function score(
  outfit: Outfit,
  { basis, formality, otherFormalities, weather, preferences, daysSinceWorn }: ScoringFacts,
): Scores {
  const items = Object.values(outfit);
  const days = (c: Clothing) => daysSinceWorn.get(c.id) ?? Infinity;
  const scores: Scores = {
    color: colorHarmony(items),
    style: styleConsistency(items),
    preference: average(items.map((c) => preferenceMatch(c, preferences))),
    recency: average(items.map((c) => Math.min(days(c), RECENT_DAYS) / RECENT_DAYS)),
    utilization: average(items.map((c) => Math.min(days(c), LONG_UNWORN_DAYS) / LONG_UNWORN_DAYS)),
  };
  if (basis && formality) {
    scores.event = average(items.map((c) => eventFit(c, formality, otherFormalities)));
  }
  if (weather) {
    scores.weather = average(items.map((c) => weatherFit(c, weather)));
  }
  return scores;
}

// The order factors are listed in, which also settles equal contributions.
const FACTORS: Factor[] = ["weather", "event", "color", "style", "preference", "recency", "utilization"];

// The 근거 of the factors that added most to the 코디's score (weight times
// score), up to MAX_REASONS. Factors that added nothing, or that no piece of
// the 코디 stands for, give no 근거.
function topEvidence(outfit: Outfit, scores: Scores, scoring: ScoringFacts): Evidence[] {
  const contribution = (factor: Factor) => WEIGHTS[factor] * (scores[factor] ?? 0);
  return FACTORS.filter((factor) => contribution(factor) > 0)
    .sort((a, b) => contribution(b) - contribution(a))
    .flatMap((factor) => {
      const found = evidenceFor(factor, outfit, scoring);
      return found && found.clothes.length ? [found] : [];
    })
    .slice(0, MAX_REASONS);
}

// What made `factor` score well for the 코디, from the same facts the score
// came from. Null when the factor did not apply.
function evidenceFor(
  factor: Factor,
  outfit: Outfit,
  { basis, formality, basisTitle, otherFormalities, weather, preferences, daysSinceWorn }: ScoringFacts,
): Evidence | null {
  const items = Object.values(outfit);
  const days = (c: Clothing) => daysSinceWorn.get(c.id) ?? Infinity;
  switch (factor) {
    case "weather":
      if (!weather) return null;
      return {
        factor,
        // An 아우터 is there for the weather, however well it fits.
        clothes: items.filter((c) => c.slot === "outer" || weatherFit(c, weather) === 1),
        facts: { temperature: weather.temperature, rain: weather.rain },
      };
    case "event":
      if (!basis || !formality) return null;
      return {
        factor,
        clothes: items.filter((c) => eventFit(c, formality, otherFormalities) === 1),
        facts: { kind: basis.kind, formality, title: basisTitle },
      };
    case "color": {
      const colors = [...new Set(items.map((c) => c.color))];
      return {
        factor,
        clothes: items,
        facts: { colors, accents: colors.filter((color) => !NEUTRAL_COLORS.has(color)) },
      };
    }
    case "style": {
      const counts = new Map<Style, number>();
      for (const { style } of items) counts.set(style, (counts.get(style) ?? 0) + 1);
      const style = maxBy([...counts], ([, count]) => count)![0];
      return { factor, clothes: items.filter((c) => c.style === style), facts: { style } };
    }
    case "preference": {
      const clothes = items.filter((c) => preferenceMatch(c, preferences) > 0);
      return {
        factor,
        clothes,
        facts: {
          colors: preferences.colors.filter((color) => clothes.some((c) => c.color === color)),
          styles: preferences.styles.filter((style) => clothes.some((c) => c.style === style)),
        },
      };
    }
    case "recency":
      return { factor, clothes: items.filter((c) => days(c) >= RECENT_DAYS), facts: { days: RECENT_DAYS } };
    case "utilization":
      return {
        factor,
        clothes: items.filter((c) => days(c) >= LONG_UNWORN_DAYS),
        facts: { days: LONG_UNWORN_DAYS },
      };
  }
}

// How well one piece suits the day's 일정: full marks at the 기준 일정's 격식
// 수준, half one level off, less the further it is two levels off the day's
// other 일정.
function eventFit(clothing: Clothing, formality: Formality, otherFormalities: Formality[]) {
  const level = FORMALITY_LEVEL[clothing.formality];
  const fit = 1 - Math.abs(level - FORMALITY_LEVEL[formality]) / 2;
  if (!otherFormalities.length) return fit;
  const farOff = otherFormalities.filter((f) => Math.abs(level - FORMALITY_LEVEL[f]) >= 2).length;
  return Math.max(0, fit - (OTHER_EVENT_PENALTY * farOff) / otherFormalities.length);
}

// How well one piece suits the day: its 두께 against the 기온, and, on a rainy
// day, whether its 소재 stands up to rain.
function weatherFit(clothing: Clothing, { temperature, rain }: Weather) {
  if (rain && RAIN_WEAK_MATERIALS.has(clothing.material)) return 0;
  const target = clothing.slot === "outer" ? outerWarmth(temperature) : baseWarmth(temperature);
  return 1 - Math.abs(clothing.warmth - target) / 2;
}

// The 두께 that suits the 기온 for what is worn under any 아우터.
function baseWarmth(temperature: number) {
  return temperature >= 23 ? 1 : temperature >= 10 ? 2 : 3;
}

// The 두께 that suits the 기온 for an 아우터.
function outerWarmth(temperature: number) {
  return temperature >= 12 ? 1 : temperature >= 5 ? 2 : 3;
}

function total(scores: Scores) {
  return Object.entries(scores).reduce(
    (sum, [factor, value]) => sum + WEIGHTS[factor as keyof Scores] * value,
    0,
  );
}

function colorHarmony(items: Clothing[]) {
  const accents = new Set(items.map((c) => c.color).filter((color) => !NEUTRAL_COLORS.has(color)));
  return accents.size <= 1 ? 1 : accents.size === 2 ? 0.5 : 0;
}

// The share of the 코디 in its most common style.
function styleConsistency(items: Clothing[]) {
  const counts = new Map<string, number>();
  for (const { style } of items) counts.set(style, (counts.get(style) ?? 0) + 1);
  return Math.max(...counts.values()) / items.length;
}

// How well one piece matches what the user likes, counting only the kinds of
// preference they have set.
function preferenceMatch(clothing: Clothing, { colors, styles }: Preferences) {
  const matches = [];
  if (colors.length) matches.push(colors.includes(clothing.color) ? 1 : 0);
  if (styles.length) matches.push(styles.includes(clothing.style) ? 1 : 0);
  return matches.length ? average(matches) : 0;
}

// The first item with the highest key, so ties go to the clothes added first.
function maxBy<T>(items: T[], key: (item: T) => number): T | undefined {
  let best: T | undefined;
  let bestKey = -Infinity;
  for (const item of items) {
    const k = key(item);
    if (k > bestKey) [best, bestKey] = [item, k];
  }
  return best;
}

function average(values: number[]) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function missingSlots(clothes: Clothing[]): Slot[] {
  const has = (slot: Slot) => clothes.some((c) => c.slot === slot);
  const missing: Slot[] = [];
  if (!has("dress")) {
    if (!has("top")) missing.push("top");
    if (!has("bottom")) missing.push("bottom");
  }
  if (!has("shoes")) missing.push("shoes");
  return missing;
}

// Every complete 코디 the 옷장 can make: 상의·하의·신발, or 원피스·신발, each
// with an 아우터 when one is needed and the 옷장 has any.
function candidateOutfits(clothes: Clothing[], needsOuter: boolean): Outfit[] {
  const of = (slot: Slot) => clothes.filter((c) => c.slot === slot);
  const outfits: Outfit[] = [];
  for (const shoes of of("shoes")) {
    for (const top of of("top")) {
      for (const bottom of of("bottom")) outfits.push({ top, bottom, shoes });
    }
    for (const dress of of("dress")) outfits.push({ dress, shoes });
  }
  const outers = of("outer");
  if (!needsOuter || !outers.length) return outfits;
  return outfits.flatMap((outfit) => outers.map((outer) => ({ ...outfit, outer })));
}

export type OutfitRecommender = ReturnType<typeof createOutfitRecommender>;
