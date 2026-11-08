// The 코디 추천 module. Callers see only its entry points; everything that goes
// into choosing a 코디 happens inside: scoring in scoring.ts, 수정 조건 in
// revision.ts, and what it needs from outside in ports.ts.
import { regionOfPlace } from "./places";
import { EVENT_KINDS, type EventKind } from "./situations";
import { templateSentence } from "./reasons";
import { todayInKorea } from "./dates";
import type { Clothing, Formality, Slot, Wardrobe } from "./wardrobe";
import type { EventCorrections } from "./event-corrections";
import type { WearRecords, WearStatus } from "./wear-records";
import type { RecommendationSessions } from "./recommendation-sessions";
import type {
  CalendarEvent,
  CalendarSource,
  Coordinates,
  EventJudgement,
  LanguageModel,
  Weather,
  WeatherSource,
} from "./ports";
import {
  FORMALITY_LEVEL,
  maxBy,
  score,
  topEvidence,
  total,
  type Basis,
  type Outfit,
  type Reason,
  type Scores,
  type ScoringFacts,
} from "./scoring";
import {
  accumulate,
  changesBetween,
  hasColorDirection,
  resolved,
  shifted,
  warningsFor,
  type Revision,
  type RevisionCondition,
  type UnappliedRevision,
} from "./revision";

export type {
  AskedCondition,
  CalendarEvent,
  CalendarSource,
  CalendarStatus,
  Coordinates,
  EventJudgement,
  EventText,
  LanguageModel,
  RevisionRequest,
  Weather,
  WeatherSource,
} from "./ports";
export type { Basis, Evidence, Factor, Outfit, Reason, Scores } from "./scoring";
export type {
  ColorDirection,
  OutfitChange,
  Revision,
  RevisionCondition,
  RevisionWarning,
  StyleDirection,
  UnappliedRevision,
} from "./revision";

// One of the day's 일정 with what was judged of it, or null when it could not
// be judged.
export type DayEvent = CalendarEvent & { judgement: EventJudgement | null };

// Information the recommendation had to go without.
//   no-forecast: the date is outside the forecast range (날씨 미반영)
//   weather-failed: the 날씨 어댑터 failed
//   unknown-place: the 기준 일정's 장소 names no place the weather can be
//     looked up for, so it is the 기본 지역's
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
  | "unknown-place"
  | "calendar-reconnect-needed"
  | "calendar-failed"
  | "llm-failed"
  | "reasons-llm-failed"
  | "revision-llm-failed";

type RecommendationContext = {
  date: string;
  // What 날짜로 추천받기 was asked for besides the date: the situation the
  // user picked and where the 코디 is worn. Absent from steps stored before
  // they were kept.
  situation: EventKind | null;
  location: Coordinates;
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
// for the same day, until 일정 판단 직접 고치기 finds it again.
type FoundDay = Omit<RecommendationContext, "accepted">;

// A 추천 세션 step as stored: the 추천 결과, which is a 수정 결과 unless
// `revision` is null (날짜로 추천받기's).
type Step = OutfitChoice & { revision: Revision | null };

// The day of a session step, as stored. The 기준 일정 is the one among the
// day's 일정 again, as it was returned.
function dayOf(step: Step): FoundDay {
  const { date, situation, location, events, baseEvent, basis, weather, weatherPlace } = step;
  return {
    date,
    situation,
    location,
    events,
    baseEvent: baseEvent && (events.find((e) => e.calendarId === baseEvent.calendarId && e.id === baseEvent.id) ?? null),
    basis,
    weather,
    weatherPlace,
    missing: step.missing.filter((m) => DAY_MISSING.includes(m)),
  };
}

// The MissingInfo that is about the day rather than one 코디.
const DAY_MISSING: MissingInfo[] = [
  "no-forecast",
  "weather-failed",
  "unknown-place",
  "calendar-reconnect-needed",
  "calendar-failed",
  "llm-failed",
];

// The 코디 the user already accepted ("입을게요") for the date, if any.
// Clothes since removed from the 옷장 are left out.
export type Accepted = { status: WearStatus; clothes: Clothing[] } | null;

// The 코디 chosen for the day, or why there is none.
type OutfitChoice = RecommendationContext &
  (
    // `reasons`: the 추천 이유, from the factors that added most to the score.
    | { status: "ok"; outfit: Outfit; scores: Scores; reasons: Reason[] }
    // The 옷장 has nothing to fill these slots with.
    | { status: "unbuildable"; missingSlots: Slot[] }
  );

export type Recommendation = Step & {
  // The 추천 세션 this result is a step of, for 대화로 수정하기.
  sessionId: string;
  // Which step of the 추천 세션 this is: 0 for 날짜로 추천받기, then one more
  // per 수정. Every earlier step can be gone back to (되돌리기).
  step: number;
  // The 대화 message just sent that changed nothing, and why, or null.
  unapplied: UnappliedRevision | null;
};

// Below this 기온 (°C) the 코디 gets an 아우터.
const OUTER_BELOW = 17;

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
      const day = await findDay(userId, date, situation, location);
      const step = await recommend(userId, day, await wardrobe.clothes(userId), {
        formality: day.basis?.formality ?? null,
        conditions: [],
        shown,
      });
      const sessionId = await sessions.start<Step>(userId, date, { ...step, revision: null });
      return { ...step, sessionId, step: 0, revision: null, unapplied: null };
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
      const last = session.steps.at(-1)!;
      // The latest step, left as it was.
      const unchanged = { ...last, sessionId, step: session.steps.length - 1 };
      const wardrobeClothes = await wardrobe.clothes(userId);
      let asked: ReturnType<typeof resolved>;
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
        return { ...unchanged, missing: [...last.missing, "revision-llm-failed"], unapplied: null };
      }
      // A piece the user meant could not be told: nothing is changed rather
      // than the rest of the message applied without it.
      if (asked.unknownClothing) return { ...unchanged, unapplied: { reason: "unknown-clothing", message } };
      // Nothing asked of the 코디: the user is asked to talk about the 코디
      // instead.
      if (!asked.conditions.length) return { ...unchanged, unapplied: { reason: "off-topic", message } };
      const earlier = last.revision?.conditions ?? [];
      const conditions = accumulate(earlier, asked.conditions);
      const day = dayOf(last);
      const anchor = anchorFormality(day, session.steps[0]);
      // A 스타일 방향 that leaves the 격식 수준 where it is would change nothing.
      const style = asked.conditions.find((c) => c.type === "style");
      if (style && shifted(anchor, conditions) === shifted(anchor, earlier)) {
        return { ...unchanged, unapplied: { reason: "style-limit", message, direction: style.direction } };
      }
      const under = (some: RevisionCondition[]) =>
        outfitsUnder(wardrobeClothes, day.weather, shifted(anchor, some), some);
      const { clothes, candidates } = under(conditions);
      if (!candidates.length) {
        // The conditions that could be met were it not for them, else every
        // one this message added.
        const blocking = conditions.filter((c) => under(conditions.filter((other) => other !== c)).candidates.length);
        const unmet = blocking.length ? blocking : conditions.filter((c) => !earlier.includes(c));
        return {
          ...unchanged,
          unapplied: { reason: "unbuildable", message, unmet, missingSlots: missingSlots(clothes) },
        };
      }
      const step = await recommend(userId, day, wardrobeClothes, {
        formality: shifted(anchor, conditions),
        conditions,
        shown: [],
      });
      const revision: Revision = {
        message,
        conditions,
        changes: changesBetween(last, step, conditions),
        warnings: warningsFor(day.basis, conditions),
      };
      await sessions.saveSteps<Step>(userId, sessionId, [...session.steps, { ...step, revision }]);
      return { ...step, sessionId, step: session.steps.length, revision, unapplied: null };
    },

    // The 추천 결과 of the session's latest step as it was returned, with the
    // 코디 accepted for the date now. Null when the session is not the user's
    // or a later 날짜로 추천받기 replaced it.
    async latest({ userId, sessionId }: { userId: string; sessionId: string }): Promise<Recommendation | null> {
      const session = await sessions.get<Step>(userId, sessionId);
      if (!session) return null;
      const last = session.steps.at(-1)!;
      return {
        ...last,
        sessionId,
        step: session.steps.length - 1,
        accepted: await acceptedOn(userId, last.date, await wardrobe.clothes(userId)),
        unapplied: null,
      };
    },

    // 되돌리기: the session goes back to its step `step` (0 for the first
    // 추천), with that step's 코디 and 수정 조건; the steps after it are
    // dropped, and later 수정 build on it.
    async undo({ userId, sessionId, step }: { userId: string; sessionId: string; step: number }): Promise<Recommendation> {
      const session = await sessions.get<Step>(userId, sessionId);
      if (!session) throw new Error("No such 추천 세션");
      if (!Number.isInteger(step) || step < 0 || step >= session.steps.length) {
        throw new Error("No such step in the 추천 세션");
      }
      const steps = session.steps.slice(0, step + 1);
      await sessions.saveSteps<Step>(userId, sessionId, steps);
      const back = steps[step];
      return {
        ...back,
        sessionId,
        step,
        accepted: await acceptedOn(userId, back.date, await wardrobe.clothes(userId)),
        unapplied: null,
      };
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
    // In the 추천 세션 `sessionId`, the day is found again with the
    // correction and its 코디 chosen anew under the 수정 조건 so far, as one
    // more step; the steps before it can still be gone back to. Resolves to
    // that step, or to null without a session to continue (none given, gone,
    // or stored before sessions kept what the day was asked for).
    async correctEvent({
      userId,
      eventId,
      judgement,
      sessionId,
    }: {
      userId: string;
      eventId: string;
      judgement: EventJudgement;
      sessionId?: string;
    }): Promise<Recommendation | null> {
      await eventCorrections.save(userId, eventId, judgement);
      const session = sessionId && (await sessions.get<Step>(userId, sessionId));
      if (!session) return null;
      const last = session.steps.at(-1)!;
      if (!last.location) return null;
      const day = await findDay(userId, last.date, last.situation ?? null, last.location);
      const conditions = last.revision?.conditions ?? [];
      const step = await recommend(userId, day, await wardrobe.clothes(userId), {
        formality: shifted(anchorFormality(day, session.steps[0]), conditions),
        conditions,
        shown: [],
      });
      const revision: Revision | null = last.revision && {
        ...last.revision,
        changes: changesBetween(last, step, conditions),
        warnings: warningsFor(day.basis, conditions),
      };
      await sessions.saveSteps<Step>(userId, session.id, [...session.steps, { ...step, revision }]);
      return { ...step, sessionId: session.id, step: session.steps.length, revision, unapplied: null };
    },

    // 수락 취소: forgets the 착용 기록 or plan for `date`.
    async cancelAcceptance({ userId, date }: { userId: string; date: string }) {
      await wearRecords.remove(userId, date);
    },
  };

  // The day on `date`: its 일정 from the calendar, judged; the 기준 일정 and
  // the basis the 코디 is chosen for (the picked `situation` without a judged
  // 일정); and the weather where it is worn: at the 기준 일정's 장소 when it
  // names a known place, else at `location` (the 기본 지역).
  async function findDay(
    userId: string,
    date: string,
    situation: EventKind | null,
    location: Coordinates,
  ): Promise<FoundDay> {
    const missing: MissingInfo[] = [];
    const calendarDay = await dayEvents(userId, date);
    if (calendarDay.failure) missing.push(calendarDay.failure);
    const { events, failed } = await judged(userId, calendarDay.events);
    if (failed) missing.push("llm-failed");
    const baseEvent = mostFormal(events) ?? events[0] ?? null;
    const basis =
      baseEvent?.judgement ?? (situation && { kind: situation, formality: EVENT_KINDS[situation].formality });

    const place = baseEvent?.location ? regionOfPlace(baseEvent.location) : null;
    if (baseEvent?.location && !place) missing.push("unknown-place");
    const { latitude, longitude } = place ?? location;
    let weather: Weather | null = null;
    try {
      weather = await weatherSource.forecast({ date, latitude, longitude });
      if (!weather) missing.push("no-forecast");
    } catch {
      missing.push("weather-failed");
    }
    return { date, situation, location, events, baseEvent, basis, weather, weatherPlace: place?.name ?? null, missing };
  }

  // The best 코디 for the day from `wardrobeClothes`, chosen at `formality`
  // under the 수정 조건, and explained. Both entry points choose through this.
  async function recommend(
    userId: string,
    day: FoundDay,
    wardrobeClothes: Clothing[],
    {
      formality,
      conditions,
      shown,
    }: { formality: Formality | null; conditions: RevisionCondition[]; shown: string[][] },
  ): Promise<OutfitChoice> {
    const missing = [...day.missing];
    const context = { ...day, missing, accepted: await acceptedOn(userId, day.date, wardrobeClothes) };
    const scoring = await scoringFacts(userId, day);
    const { clothes, candidates } = outfitsUnder(wardrobeClothes, day.weather, formality, conditions);
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

  // What every 코디 for the day is scored against. The 일정 score is always
  // against the 기준 일정 itself, also when 대화로 수정하기 asked for another
  // 격식 수준: the clothes are chosen at that one, but are not said to suit
  // the 일정 better than they do.
  async function scoringFacts(userId: string, day: FoundDay): Promise<ScoringFacts> {
    const { events, baseEvent, basis, weather, date } = day;
    return {
      basis,
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

// Every 코디 the 옷장 can make for the day at `formality` under the 수정 조건,
// and the clothes they may be made of. Under a 색상 방향 every 코디 has a
// piece in it, so none when the 옷장 has no such piece to wear.
function outfitsUnder(
  wardrobeClothes: Clothing[],
  weather: Weather | null,
  formality: Formality | null,
  conditions: RevisionCondition[],
) {
  const kept = wardrobeClothes.filter((c) =>
    conditions.some((condition) => condition.type === "keep" && condition.clothing.id === c.id),
  );
  const color = conditions.find((c) => c.type === "color");
  const clothes = conditioned(wardrobeClothes, formality, conditions);
  const needsOuter = (weather !== null && weather.temperature < OUTER_BELOW) || kept.some((c) => c.slot === "outer");
  const candidates = candidateOutfits(clothes, needsOuter).filter(
    (outfit) =>
      kept.every((c) => Object.values(outfit).includes(c)) &&
      (!color || Object.values(outfit).some((c) => hasColorDirection(c.color, color.direction))),
  );
  return { clothes, candidates };
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

// The 격식 수준 a 스타일 방향 moves away from: the day's basis's, or, without
// one, the one most of the session's first 코디 has.
function anchorFormality(day: FoundDay, first: Step): Formality | null {
  if (day.basis) return day.basis.formality;
  if (first.status !== "ok") return null;
  const counts = new Map<Formality, number>();
  for (const { formality } of Object.values(first.outfit)) counts.set(formality, (counts.get(formality) ?? 0) + 1);
  return maxBy([...counts], ([, count]) => count)![0];
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
