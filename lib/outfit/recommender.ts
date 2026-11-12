// The 코디 추천 module. Callers see only its entry points; everything that goes
// into choosing a 코디 happens inside: scoring in scoring.ts, 수정 조건 in
// revision.ts, and what it needs from outside in ports.ts.
import { regionOfPlace } from "./places";
import { EVENT_KINDS, type EventKind } from "./situations";
import { templateSentence } from "./reasons";
import { addDays, daysBetween, todayInKorea } from "./dates";
import {
  ASSUMED_DAYS_SINCE_WORN,
  type Clothing,
  type ClothingFields,
  type Formality,
  type Slot,
  type Wardrobe,
} from "./wardrobe";
import type { EventCorrections } from "./event-corrections";
import type { WearRecords, WearStatus } from "./wear-records";
import type { RecommendationSessions } from "./recommendation-sessions";
import {
  multipliersFrom,
  REJECTION_REASONS,
  tiltFrom,
  weightsFrom,
  type Multipliers,
  type RejectionReason,
} from "./tuning";
import type { TuningStore } from "./tuning-store";
import { fieldsOf, fingerprintOf, type DayConditions, type PieceAdviser } from "./one-more-piece";
import { outfitsUnder } from "./outfits-under";
import {
  accumulatePurchase,
  allNewOutfit,
  checkedPieces,
  choosePurchaseOutfits,
  mergedPool,
  pieceRequest,
  PURCHASE_OUTFITS,
  replyFacts,
  resolvedPurchase,
  styleOf,
  templateReply,
  wholeOutfit,
  type PurchaseCondition,
  type PurchaseOutfits,
} from "./purchase";
import type { PieceStore } from "./one-more-piece-store";
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
  resolved,
  shifted,
  warningsFor,
  type Revision,
  type RevisionCondition,
  type StyleDirection,
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
export type { AddedPiece, PurchaseCondition, PurchaseOutfit, PurchaseOutfits } from "./purchase";
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
// `fixed`: the piece the 추천 was asked to keep (고정 추천), which every
// later 수정 keeps too. Absent in sessions from before it existed.
type Step = OutfitChoice & { revision: Revision | null; fixed?: Clothing | null };

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


// How far back the 스타일 방향 for the 격식 기울기 are counted.
const TILT_DAYS = 30;

// The 격식 수준 to choose at under the 격식 기울기: only on a day without
// calendar 일정, one step that way from the picked situation's, or from
// 캐주얼 or 세미 포멀 without one.
function tilted(day: FoundDay, formality: Formality | null, tilt: "casual" | "formal" | null): Formality | null {
  if (!tilt || day.events.length > 0) return formality;
  if (!formality) return tilt === "casual" ? "casual" : "semi-formal";
  return shifted(formality, [{ type: "style", direction: tilt }]);
}

// How many days a 입기 싫은 옷 is left out, the day it was picked included.
const DISLIKE_DAYS = 14;


// How many 활용 코디 are made at most.
const STYLING_OUTFITS = 3;

export function createOutfitRecommender({
  wardrobe,
  weather: weatherSource,
  calendar,
  llm,
  wearRecords,
  eventCorrections,
  sessions,
  tuning,
  pieceAdviser,
  pieceStore,
  today = todayInKorea,
}: {
  wardrobe: Pick<Wardrobe, "clothes" | "clothesIncludingTidied" | "tidiedClothes" | "preferences">;
  weather: WeatherSource;
  calendar: CalendarSource;
  llm: LanguageModel;
  wearRecords: WearRecords;
  eventCorrections: EventCorrections;
  sessions: RecommendationSessions;
  tuning: TuningStore;
  // The LLM's 한 벌 후보 and where they are kept, for 구매 추천.
  pieceAdviser: PieceAdviser;
  pieceStore: PieceStore;
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
      fixedClothingId,
    }: {
      userId: string;
      // YYYY-MM-DD
      date: string;
      situation: EventKind | null;
      // Where the 코디 is worn: the user's 기본 지역 for now.
      location: Coordinates;
      shown?: string[][];
      // 고정 추천: a piece of the 옷장 every 코디 of the session must have.
      fixedClothingId?: string;
    }): Promise<Recommendation> {
      const day = await findDay(userId, date, situation, location);
      const clothes = await wardrobe.clothes(userId);
      const fixed = clothes.find((c) => c.id === fixedClothingId) ?? null;
      const step = await recommend(userId, day, clothes, {
        formality: tilted(day, day.basis?.formality ?? null, await activeTilt(userId)),
        conditions: fixedConditions(fixed),
        shown,
      });
      const sessionId = await sessions.start<Step>(userId, date, { ...step, revision: null, fixed });
      return { ...step, sessionId, step: 0, revision: null, unapplied: null };
    },

    // 활용 코디: up to STYLING_OUTFITS different 코디 with the piece, the
    // best scored first, for `date` at `location` and, if given, at
    // `formality`. Without 추천 이유, so the LLM is not asked.
    async stylingOutfits({
      userId,
      clothingId,
      date,
      location,
      formality = null,
    }: {
      userId: string;
      clothingId: string;
      date: string;
      location: Coordinates;
      formality?: Formality | null;
    }): Promise<Outfit[]> {
      const clothes = await wardrobe.clothes(userId);
      const piece = clothes.find((c) => c.id === clothingId);
      if (!piece) return [];
      // Only the weather: no 일정, so neither the calendar nor the LLM.
      const weather = await weatherSource.forecast({ date, ...location }).catch(() => null);
      const day: FoundDay = {
        date,
        situation: null,
        location,
        events: [],
        baseEvent: null,
        basis: null,
        weather,
        weatherPlace: null,
        missing: [],
      };
      const scoring = await scoringFacts(userId, day);
      const { candidates } = outfitsUnder(clothes, day.weather, formality, fixedConditions(piece), await dislikedNow(userId));
      return candidates
        .map((outfit) => ({ outfit, total: total(score(outfit, scoring), scoring.weights) }))
        .sort((a, b) => b.total - a.total)
        .slice(0, STYLING_OUTFITS)
        .map(({ outfit }) => outfit);
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
      // Each 스타일 방향 asked for counts toward the 격식 기울기.
      for (const condition of asked.conditions) {
        if (condition.type === "style") await tuning.saveStyleRequest(userId, today(), condition.direction);
      }
      const earlier = last.revision?.conditions ?? fixedConditions(session.steps[0].fixed);
      const conditions = accumulate(earlier, asked.conditions);
      const day = dayOf(last);
      const anchor = anchorFormality(day, session.steps[0]);
      // A 스타일 방향 that leaves the 격식 수준 where it is would change nothing.
      const style = asked.conditions.find((c) => c.type === "style");
      if (style && shifted(anchor, conditions) === shifted(anchor, earlier)) {
        return { ...unchanged, unapplied: { reason: "style-limit", message, direction: style.direction } };
      }
      const disliked = await dislikedNow(userId);
      const under = (some: RevisionCondition[]) =>
        outfitsUnder(wardrobeClothes, day.weather, shifted(anchor, some), some, disliked);
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
        accepted: await acceptedOn(userId, last.date),
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
        accepted: await acceptedOn(userId, back.date),
        unapplied: null,
      };
    },

    // "입을게요": the user will wear these clothes on `date`. Replaces any 코디
    // already accepted for that date. Only clothes from the user's 옷장.
    // With the 추천 세션 it came from, the factors of the accepted 코디's 추천
    // 이유 count toward 추천 맞춤, once per date.
    async accept({
      userId,
      date,
      clothingIds,
      sessionId,
    }: {
      userId: string;
      date: string;
      clothingIds: string[];
      sessionId?: string;
    }) {
      const owned = new Set((await wardrobe.clothes(userId)).map((c) => c.id));
      if (!clothingIds.length || !clothingIds.every((id) => owned.has(id))) {
        throw new Error("Only clothes from the user's 옷장 can be accepted");
      }
      const status: WearStatus = date <= today() ? "worn" : "planned";
      await wearRecords.save(userId, { date, status, clothingIds });

      const last = sessionId && (await sessions.get<Step>(userId, sessionId))?.steps.at(-1);
      const sameOutfit =
        last && last.status === "ok" && sameIds(Object.values(last.outfit).map((c) => c.id), clothingIds);
      if (sameOutfit) {
        await tuning.saveAcceptance(userId, date, last.reasons.map((r) => r.evidence.factor));
      } else {
        await tuning.removeAcceptance(userId, date);
      }
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
      const conditions = last.revision?.conditions ?? fixedConditions(session.steps[0].fixed);
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

    // 거절: the user wanted another 코디 than `clothingIds` for `date`, maybe
    // saying why. Only recorded; 다시 추천받기 then asks for the next 코디.
    async reject({
      userId,
      date,
      clothingIds,
      reason = null,
      dislikedClothingId = null,
    }: {
      userId: string;
      date: string;
      clothingIds: string[];
      reason?: RejectionReason | null;
      // With reason "dislike": the piece of the 코디 the user won't wear.
      dislikedClothingId?: string | null;
    }) {
      if (reason !== null && !REJECTION_REASONS.includes(reason)) throw new Error("Unknown 거절 이유");
      const disliked = reason === "dislike" ? dislikedClothingId : null;
      if (reason === "dislike" && (!disliked || !clothingIds.includes(disliked))) {
        throw new Error("The 입기 싫은 옷 must be one of the rejected 코디");
      }
      await tuning.saveRejection(userId, { date, reason, dislikedClothingId: disliked });
    },

    // 구매 추천 코디 for the day, as 날짜로 추천받기 would find it: owned clothes
    // with one new piece each, or, when the 옷장 makes no 코디 for the day,
    // whole new 코디. The LLM proposes; the score rules choose. Starts a 구매
    // 추천 세션 for 구매 대화.
    async purchaseOutfits({
      userId,
      date,
      situation,
      location,
    }: {
      userId: string;
      date: string;
      situation: EventKind | null;
      location: Coordinates;
    }): Promise<PurchaseRecommendation> {
      const day = await findDay(userId, date, situation, location);
      const formality = tilted(day, day.basis?.formality ?? null, await activeTilt(userId));
      const [clothes, tidied, preferences, disliked] = await Promise.all([
        wardrobe.clothes(userId),
        wardrobe.tidiedClothes(userId),
        wardrobe.preferences(userId),
        dislikedNow(userId),
      ]);
      const fingerprint = fingerprintOf(clothes, tidied);
      const ask = async (key: string, propose: () => Promise<unknown[]>) => {
        const saved = await pieceStore.candidates(userId, key, fingerprint);
        if (saved) return saved;
        try {
          const proposed = await propose();
          await pieceStore.saveCandidates(userId, key, fingerprint, proposed);
          return proposed;
        } catch (error) {
          console.error("Could not get 구매 추천 from the LLM", error);
          return null;
        }
      };
      const dayKey = `${date}:${formality ?? "any"}`;

      let result: PurchaseOutfits;
      let pool: ClothingFields[] = [];
      if (!outfitsUnder(clothes, day.weather, formality, [], disliked).candidates.length) {
        const raw = await ask(`outfits:${dayKey}`, () =>
          pieceAdviser.proposeOutfits({ day: dayConditions(day, formality), preferences }),
        );
        const whole = (raw ?? []).flatMap((o) => wholeOutfit(o) ?? []).slice(0, PURCHASE_OUTFITS);
        pool = mergedPool([], whole.flatMap((o) => Object.values(o)));
        result = raw ? { kind: "all-new", outfits: whole.map(allNewOutfit) } : { kind: "unavailable" };
      } else {
        const raw = await ask(`day:${dayKey}`, () =>
          pieceAdviser.proposePieces({
            target: { day: dayConditions(day, formality) },
            wardrobe: clothes.map(fieldsOf),
            preferences,
          }),
        );
        pool = checkedPieces(raw ?? []);
        result = raw
          ? {
              kind: "with-wardrobe",
              outfits: choosePurchaseOutfits({
                owned: clothes,
                tidied,
                pool,
                conditions: [],
                formality,
                weather: day.weather,
                disliked,
                scoreOf: await scorer(userId, day),
                exactlyOne: true,
              }),
            }
          : { kind: "unavailable" };
      }
      const first: PurchaseStep = {
        day,
        formality,
        anchor: formality ?? mostCommonFormality(result),
        pool,
        result,
        conversation: null,
      };
      const sessionId = await sessions.start<PurchaseStep>(userId, date, first, "purchase");
      return purchaseView(first, sessionId, 0, null);
    },

    // 구매 대화: the 구매 추천 of the session's latest step, chosen again as
    // `message` asks on top of what was asked before, with a 비서 답장. The
    // LLM only turns the message into 구매 조건, proposes more pieces when
    // those in the session run short, and writes the 답장.
    async revisePurchase({
      userId,
      sessionId,
      message,
    }: {
      userId: string;
      sessionId: string;
      message: string;
    }): Promise<PurchaseRecommendation> {
      const session = await sessions.get<PurchaseStep>(userId, sessionId, "purchase");
      if (!session) throw new Error("No such 구매 추천 세션");
      const last = session.steps.at(-1)!;
      const unchanged = (unapplied: PurchaseUnapplied) =>
        purchaseView(last, sessionId, session.steps.length - 1, unapplied);
      const [owned, tidied, preferences, disliked] = await Promise.all([
        wardrobe.clothes(userId),
        wardrobe.tidiedClothes(userId),
        wardrobe.preferences(userId),
        dislikedNow(userId),
      ]);
      const shown = last.result.kind === "unavailable" ? [] : last.result.outfits;
      let asked: ReturnType<typeof resolvedPurchase>;
      try {
        asked = resolvedPurchase(
          await llm.interpretPurchase({
            message,
            outfits: shown.map((o) => Object.values(o.outfit)),
            addedIds: shown.flatMap((o) => o.added.map((a) => a.clothing.id)),
            wardrobe: owned,
          }),
          owned,
          shown,
        );
      } catch {
        return unchanged({ reason: "failed", message });
      }
      if (asked.unknownClothing) return unchanged({ reason: "unknown-clothing", message });
      if (!asked.conditions.length) return unchanged({ reason: "off-topic", message });

      const earlier = last.conversation?.conditions ?? [];
      const conditions = accumulatePurchase(earlier, asked.conditions);
      const { anchor } = session.steps[0];
      const style = asked.conditions.find((c) => c.type === "style");
      if (style && (!anchor || shifted(anchor, styleOf(conditions)) === shifted(anchor, styleOf(earlier)))) {
        return unchanged({ reason: "style-limit", message, direction: style.direction });
      }
      const formality = styleOf(conditions).length ? shifted(anchor, styleOf(conditions)) : session.steps[0].formality;
      const day = last.day;
      const scoreOf = await scorer(userId, day);
      const choose = (pool: ClothingFields[]) =>
        choosePurchaseOutfits({ owned, tidied, pool, conditions, formality, weather: day.weather, disliked, scoreOf });

      let pool = last.pool;
      let outfits = choose(pool);
      if (outfits.length < PURCHASE_OUTFITS) {
        try {
          const more = await pieceAdviser.proposePieces({
            target: { day: dayConditions(day, formality), request: pieceRequest(conditions) },
            wardrobe: owned.map(fieldsOf),
            preferences,
          });
          pool = mergedPool(pool, checkedPieces(more));
          outfits = choose(pool);
        } catch (error) {
          console.error("Could not get more 구매 추천 from the LLM", error);
        }
      }
      if (!outfits.length) return unchanged({ reason: "unbuildable", message });

      const facts = replyFacts(message, conditions, outfits);
      let reply: string;
      try {
        reply = (await llm.writePurchaseReply(facts)).trim();
        if (!reply) throw new Error("An empty 비서 답장");
      } catch {
        reply = templateReply(facts);
      }
      const allNew = outfits.every((o) => o.added.length === Object.values(o.outfit).length);
      const step: PurchaseStep = {
        day,
        formality,
        anchor,
        pool,
        result: { kind: allNew ? "all-new" : "with-wardrobe", outfits },
        conversation: { message, conditions, reply },
      };
      await sessions.saveSteps<PurchaseStep>(userId, sessionId, [...session.steps, step]);
      return purchaseView(step, sessionId, session.steps.length, null);
    },

    // The 구매 추천 of the 구매 추천 세션's latest step, or null when the
    // session is not the user's or a later 구매 추천 replaced it.
    async latestPurchase({ userId, sessionId }: { userId: string; sessionId: string }) {
      const session = await sessions.get<PurchaseStep>(userId, sessionId, "purchase");
      if (!session) return null;
      return purchaseView(session.steps.at(-1)!, sessionId, session.steps.length - 1, null);
    },

    // 되돌리기 in 구매 대화: back to step `step` (0 for the first 구매 추천);
    // the steps after it are dropped.
    async undoPurchase({ userId, sessionId, step }: { userId: string; sessionId: string; step: number }) {
      const session = await sessions.get<PurchaseStep>(userId, sessionId, "purchase");
      if (!session) throw new Error("No such 구매 추천 세션");
      if (!Number.isInteger(step) || step < 0 || step >= session.steps.length) {
        throw new Error("No such step in the 구매 추천 세션");
      }
      const steps = session.steps.slice(0, step + 1);
      await sessions.saveSteps<PurchaseStep>(userId, sessionId, steps);
      return purchaseView(steps[step], sessionId, step, null);
    },

    // 추천 맞춤 보기: each factor's weight as a multiple of its default.
    // and the 격식 기울기 with whether it is turned off.
    async tuning(
      userId: string,
    ): Promise<{ multipliers: Multipliers; tilt: "casual" | "formal" | null; tiltOff: boolean }> {
      const [multipliers, tilt, tiltOff] = await Promise.all([
        userMultipliers(userId),
        currentTilt(userId),
        tuning.tiltOff(userId),
      ]);
      return { multipliers, tilt, tiltOff };
    },

    // 격식 기울기 켜기·끄기.
    async setTiltOff(userId: string, off: boolean) {
      await tuning.setTiltOff(userId, off);
    },

    // 추천 맞춤 되돌리기: back to the default weights.
    async resetTuning(userId: string) {
      await tuning.reset(userId);
    },

    // 수락 취소: forgets the 착용 기록 or plan for `date`.
    async cancelAcceptance({ userId, date }: { userId: string; date: string }) {
      await wearRecords.remove(userId, date);
      await tuning.removeAcceptance(userId, date);
    },

    // The user's 캘린더 연동 is gone: drops what was kept about their calendar
    // 일정 (the 일정 판단 수정값). 착용 기록 and 추천 세션 stay.
    async forgetCalendar(userId: string) {
      await eventCorrections.forgetAll(userId);
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
    const context = { ...day, missing, accepted: await acceptedOn(userId, day.date) };
    const scoring = await scoringFacts(userId, day);
    const { clothes, candidates } = outfitsUnder(
      wardrobeClothes,
      day.weather,
      formality,
      conditions,
      await dislikedNow(userId),
    );
    const shownKeys = new Set(shown.map((ids) => [...ids].sort().join()));
    const unshown = candidates.filter((outfit) => !shownKeys.has(outfitKey(outfit)));
    const best = maxBy(
      (unshown.length ? unshown : candidates).map((outfit) => ({
        outfit,
        scores: score(outfit, scoring),
      })),
      ({ scores }) => total(scores, scoring.weights),
    );
    if (!best) {
      return { status: "unbuildable", ...context, missingSlots: missingSlots(clothes) };
    }
    const { reasons, failed } = await explain(best.outfit, best.scores, scoring);
    if (failed) missing.push("reasons-llm-failed");
    return { status: "ok", ...context, ...best, reasons };
  }

  // What was accepted for `date`, shown with every piece in it, also ones
  // 정리 since.
  async function acceptedOn(userId: string, date: string): Promise<Accepted> {
    const record = await wearRecords.onDate(userId, date);
    if (!record) return null;
    const clothes = await wardrobe.clothesIncludingTidied(userId);
    return {
      status: record.status,
      clothes: record.clothingIds.flatMap((id) => clothes.filter((c) => c.id === id)),
    };
  }

  // What every 코디 for the day is scored against. The 일정 score is always
  // against the 기준 일정 itself, also when 대화로 수정하기 asked for another
  // 격식 수준: the clothes are chosen at that one, but are not said to suit
  // the 일정 better than they do.
  // The 격식 기울기 from the 스타일 방향 asked for within TILT_DAYS.
  async function currentTilt(userId: string) {
    return tiltFrom(await tuning.styleRequestsSince(userId, addDays(today(), 1 - TILT_DAYS)));
  }

  // The 격식 기울기 to apply: none when the user turned it off.
  async function activeTilt(userId: string) {
    return (await tuning.tiltOff(userId)) ? null : currentTilt(userId);
  }

  // The 입기 싫은 옷 still left out today: picked within DISLIKE_DAYS.
  async function dislikedNow(userId: string) {
    const disliked = await tuning.dislikedSince(userId, addDays(today(), 1 - DISLIKE_DAYS));
    return new Set(disliked.map((d) => d.clothingId));
  }

  // The user's 추천 맞춤, from their 거절 and 수락 since the last reset.
  async function userMultipliers(userId: string) {
    const [rejections, acceptances] = await Promise.all([
      tuning.rejectionsSinceReset(userId),
      tuning.acceptancesSinceReset(userId),
    ]);
    return multipliersFrom({ rejections, acceptances });
  }

  // Each 코디's total score for the day, with the user's 추천 맞춤.
  async function scorer(userId: string, day: FoundDay) {
    const scoring = await scoringFacts(userId, day);
    return (outfit: Outfit) => total(score(outfit, scoring), scoring.weights);
  }

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
      weights: weightsFrom(await userMultipliers(userId)),
      ...(await daysSinceLastWorn(userId, date)),
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

  // Per clothing id, days from its latest 착용 기록 before `date` to `date`;
  // plans never count. A piece with no 착용 기록 is taken as its 추정 착용
  // 빈도 suggests, and listed in `estimated`.
  async function daysSinceLastWorn(userId: string, date: string) {
    const daysSinceWorn = new Map<string, number>();
    for (const record of await wearRecords.wornBefore(userId, date)) {
      for (const id of record.clothingIds) {
        if (!daysSinceWorn.has(id)) daysSinceWorn.set(id, daysBetween(record.date, date));
      }
    }
    const estimated = new Set<string>();
    for (const clothing of await wardrobe.clothes(userId)) {
      const days = clothing.estimatedWearFrequency && ASSUMED_DAYS_SINCE_WORN[clothing.estimatedWearFrequency];
      if (daysSinceWorn.has(clothing.id) || days === null || days === undefined) continue;
      daysSinceWorn.set(clothing.id, days);
      estimated.add(clothing.id);
    }
    return { daysSinceWorn, estimated };
  }
}


function sameIds(a: string[], b: string[]) {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

// The 수정 조건 a 고정 추천 starts with.
function fixedConditions(fixed: Clothing | null | undefined): RevisionCondition[] {
  return fixed ? [{ type: "keep", clothing: fixed }] : [];
}

function outfitKey(outfit: Outfit) {
  return Object.values(outfit)
    .map((c) => c.id)
    .sort()
    .join();
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


// A 구매 추천 세션 step as stored: the day it is for, the 격식 수준 the new
// pieces are chosen at and the one a 스타일 방향 moves from, every new piece
// the LLM proposed in the session so far, and the 구매 추천 with the 구매 대화
// that led to it (none for the first).
type PurchaseStep = {
  day: FoundDay;
  formality: Formality | null;
  anchor: Formality | null;
  pool: ClothingFields[];
  result: PurchaseOutfits;
  conversation: PurchaseConversation | null;
};

// One 구매 대화 turn: what was said, every 구매 조건 so far, and the 비서 답장.
export type PurchaseConversation = { message: string; conditions: PurchaseCondition[]; reply: string };

// A 구매 대화 message that left the 구매 추천 as it was.
//   failed: the LLM could not read it
//   off-topic: 무관한 메시지
//   unknown-clothing: it named a piece not found
//   style-limit: no further in that 스타일 방향
//   unbuildable: no 구매 추천 코디 meets the 구매 조건
export type PurchaseUnapplied =
  | { reason: "failed" | "off-topic" | "unknown-clothing" | "unbuildable"; message: string }
  | { reason: "style-limit"; message: string; direction: StyleDirection };

export type PurchaseRecommendation = PurchaseOutfits & {
  date: string;
  sessionId: string;
  step: number;
  conversation: PurchaseConversation | null;
  unapplied: PurchaseUnapplied | null;
};

function purchaseView(
  step: PurchaseStep,
  sessionId: string,
  index: number,
  unapplied: PurchaseUnapplied | null,
): PurchaseRecommendation {
  return { ...step.result, date: step.day.date, sessionId, step: index, conversation: step.conversation, unapplied };
}

// What the LLM is told about the day for new pieces.
function dayConditions(day: FoundDay, formality: Formality | null): DayConditions {
  return { formality, temperature: day.weather?.temperature ?? null, rain: day.weather?.rain ?? null };
}

// The 격식 수준 most pieces of the first 구매 추천 코디 have, if any.
function mostCommonFormality(result: PurchaseOutfits): Formality | null {
  const first = result.kind === "unavailable" ? undefined : result.outfits[0];
  if (!first) return null;
  const counts = new Map<Formality, number>();
  for (const { formality } of Object.values(first.outfit)) counts.set(formality, (counts.get(formality) ?? 0) + 1);
  return maxBy([...counts], ([, count]) => count)![0];
}

export type OutfitRecommender = ReturnType<typeof createOutfitRecommender>;
