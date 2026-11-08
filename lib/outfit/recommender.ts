// The 코디 추천 module. Callers see only its entry points; everything that goes
// into choosing a 코디 happens inside.
import { EVENT_KINDS, type EventKind } from "./situations";
import type { Clothing, Formality, Material, Preferences, Slot, Wardrobe } from "./wardrobe";
import type { WearRecords, WearStatus } from "./wear-records";

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

// Information the recommendation had to go without.
//   no-forecast: the date is outside the forecast range (날씨 미반영)
//   weather-failed: the 날씨 어댑터 failed
export type MissingInfo = "no-forecast" | "weather-failed";

// The 일정 the 코디 is chosen for: its 일정의 종류 and 격식 수준.
export type Basis = { kind: EventKind; formality: Formality };

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
  basis: Basis | null;
  // The weather the 코디 was chosen for, or null when it was not 반영.
  weather: Weather | null;
  missing: MissingInfo[];
  accepted: Accepted;
};

// The 코디 the user already accepted ("입을게요") for the date, if any.
// Clothes since removed from the 옷장 are left out.
export type Accepted = { status: WearStatus; clothes: Clothing[] } | null;

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
  wearRecords,
  today = todayInKorea,
}: {
  wardrobe: Pick<Wardrobe, "clothes" | "preferences">;
  weather: WeatherSource;
  wearRecords: WearRecords;
  // YYYY-MM-DD. Dates up to today are worn when accepted; later ones are plans.
  today?: () => string;
}) {
  return {
    // 날짜로 추천받기. `situation` is the 일정 the user picked, or null for 일정 없음.
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
      const basis = situation && { kind: situation, formality: EVENT_KINDS[situation].formality };
      const missing: MissingInfo[] = [];
      let weather: Weather | null = null;
      try {
        weather = await weatherSource.forecast({ date, ...location });
        if (!weather) missing.push("no-forecast");
      } catch {
        missing.push("weather-failed");
      }
      const wardrobeClothes = await wardrobe.clothes(userId);
      const record = await wearRecords.onDate(userId, date);
      const accepted: Accepted = record
        ? {
            status: record.status,
            clothes: record.clothingIds.flatMap((id) => wardrobeClothes.filter((c) => c.id === id)),
          }
        : null;
      const context = { date, basis, weather, missing, accepted };

      const clothes = suitableClothes(wardrobeClothes, basis);
      const preferences = await wardrobe.preferences(userId);
      const daysSinceWorn = await daysSinceLastWorn(userId, date);
      const needsOuter = weather !== null && weather.temperature < OUTER_BELOW;
      const candidates = candidateOutfits(clothes, needsOuter);
      const shownKeys = new Set(shown.map((ids) => [...ids].sort().join()));
      const unshown = candidates.filter((outfit) => !shownKeys.has(outfitKey(outfit)));
      const best = maxBy(
        (unshown.length ? unshown : candidates).map((outfit) => ({
          outfit,
          scores: score(outfit, basis, weather, preferences, daysSinceWorn),
        })),
        ({ scores }) => total(scores),
      );
      if (!best) {
        return { status: "unbuildable", ...context, missingSlots: missingSlots(clothes) };
      }
      return { status: "ok", ...context, ...best };
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

    // 수락 취소: forgets the 착용 기록 or plan for `date`.
    async cancelAcceptance({ userId, date }: { userId: string; date: string }) {
      await wearRecords.remove(userId, date);
    },
  };

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
  daysSinceWorn: Map<string, number>,
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
