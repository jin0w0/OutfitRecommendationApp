// The 코디 추천 module. Callers see only its entry points; everything that goes
// into choosing a 코디 happens inside.
import { regionOfPlace } from "./places";
import { EVENT_KINDS, type EventKind } from "./situations";
import type { Clothing, Formality, Material, Preferences, Slot, Wardrobe } from "./wardrobe";

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

// Information the recommendation had to go without.
//   no-forecast: the date is outside the forecast range (날씨 미반영)
//   weather-failed: the 날씨 어댑터 failed
//   calendar-reconnect-needed: the 캘린더 연동 expired or was revoked, so the
//     user should see the 재연동 안내
//   calendar-failed: the 캘린더 어댑터 failed otherwise
export type MissingInfo =
  | "no-forecast"
  | "weather-failed"
  | "calendar-reconnect-needed"
  | "calendar-failed";

// The 일정 the 코디 is chosen for: its 일정의 종류 and 격식 수준.
export type Basis = { kind: EventKind; formality: Formality };

// 0..1 per factor. A factor that did not apply (e.g. 일정 with 일정 없음) is absent.
export type Scores = {
  weather?: number;
  event?: number;
  color: number;
  style: number;
  preference: number;
};

// The same defaults for every user for now.
const WEIGHTS: Required<Scores> = { weather: 3, event: 3, color: 2, style: 1, preference: 2 };

// 소재 that rain ruins.
const RAIN_WEAK_MATERIALS = new Set<Material>(["suede", "canvas"]);

// Colors that go with anything; a 코디 reads well with at most one other.
const NEUTRAL_COLORS = new Set(["black", "white", "gray", "navy", "beige", "brown"]);

type RecommendationContext = {
  date: string;
  // The day's 일정 from the calendars the user chose, in the order they happen.
  events: CalendarEvent[];
  // The 기준 일정 the 코디 is chosen for, or null without any 일정.
  baseEvent: CalendarEvent | null;
  basis: Basis | null;
  // The weather the 코디 was chosen for, or null when it was not 반영.
  weather: Weather | null;
  // The region named by the 기준 일정's 장소 that the weather is for, or null
  // when it is for the given location (the 기본 지역).
  weatherPlace: string | null;
  missing: MissingInfo[];
};

export type Recommendation = RecommendationContext &
  (
    | { status: "ok"; outfit: Outfit; scores: Scores }
    // The 옷장 has nothing to fill these slots with.
    | { status: "unbuildable"; missingSlots: Slot[] }
  );

// Below this 기온 (°C) the 코디 gets an 아우터.
const OUTER_BELOW = 17;

const FORMALITY_LEVEL: Record<Formality, number> = { casual: 0, "semi-formal": 1, formal: 2 };

export function createOutfitRecommender({
  wardrobe,
  weather: weatherSource,
  calendar,
}: {
  wardrobe: Pick<Wardrobe, "clothes" | "preferences">;
  weather: WeatherSource;
  calendar: CalendarSource;
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

  return {
    // 날짜로 추천받기. `situation` is the 일정 the user picked, or null for 일정 없음.
    async recommendForDate({
      userId,
      date,
      situation,
      location,
    }: {
      userId: string;
      // YYYY-MM-DD
      date: string;
      situation: EventKind | null;
      // Where the 코디 is worn: the user's 기본 지역 for now.
      location: Coordinates;
    }): Promise<Recommendation> {
      const basis = situation && { kind: situation, formality: EVENT_KINDS[situation].formality };
      const missing: MissingInfo[] = [];
      const { events, failure } = await dayEvents(userId, date);
      if (failure) missing.push(failure);
      const baseEvent = events[0] ?? null;

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
      const weatherPlace = place?.name ?? null;
      const context = { date, events, baseEvent, basis, weather, weatherPlace, missing };

      const clothes = suitableClothes(await wardrobe.clothes(userId), basis);
      const preferences = await wardrobe.preferences(userId);
      const needsOuter = weather !== null && weather.temperature < OUTER_BELOW;
      const best = maxBy(
        candidateOutfits(clothes, needsOuter).map((outfit) => ({
          outfit,
          scores: score(outfit, basis, weather, preferences),
        })),
        ({ scores }) => total(scores),
      );
      if (!best) {
        return { status: "unbuildable", ...context, missingSlots: missingSlots(clothes) };
      }
      return { status: "ok", ...context, ...best };
    },
  };
}

// 종일 일정 first, then by start time.
function byStart(a: CalendarEvent, b: CalendarEvent) {
  const key = (e: CalendarEvent) => (e.allDay ? -Infinity : Date.parse(e.start));
  return key(a) - key(b) || 0;
}

// Per slot, the clothes that match the 일정's 격식 수준, falling back to those
// one level off. Clothes two levels off are never worn to it.
function suitableClothes(clothes: Clothing[], basis: Basis | null) {
  if (!basis) return clothes;
  const distance = (c: Clothing) =>
    Math.abs(FORMALITY_LEVEL[c.formality] - FORMALITY_LEVEL[basis.formality]);
  const suitable: Clothing[] = [];
  for (const slot of new Set(clothes.map((c) => c.slot))) {
    const inSlot = clothes.filter((c) => c.slot === slot);
    const exact = inSlot.filter((c) => distance(c) === 0);
    suitable.push(...(exact.length ? exact : inSlot.filter((c) => distance(c) === 1)));
  }
  return suitable;
}

function score(
  outfit: Outfit,
  basis: Basis | null,
  weather: Weather | null,
  preferences: Preferences,
): Scores {
  const items = Object.values(outfit);
  const scores: Scores = {
    color: colorHarmony(items),
    style: styleConsistency(items),
    preference: average(items.map((c) => preferenceMatch(c, preferences))),
  };
  if (basis) {
    scores.event = average(items.map((c) => (c.formality === basis.formality ? 1 : 0)));
  }
  if (weather) {
    scores.weather = average(items.map((c) => weatherFit(c, weather)));
  }
  return scores;
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
