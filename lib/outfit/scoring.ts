// How a 코디 is scored for the day, and the 근거 for its 추천 이유 that the
// same scoring gives.
import type { Clothing, Formality, Material, Preferences, Season, Style } from "./wardrobe";
import type { EventJudgement, Weather } from "./ports";

export type Outfit = {
  top?: Clothing;
  bottom?: Clothing;
  dress?: Clothing;
  shoes: Clothing;
  outer?: Clothing;
};

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
  // The day's weather, and the pieces that suit it (any 아우터 among them), or
  // that suit it best when none fully does.
  | { factor: "weather"; clothes: Clothing[]; facts: Weather }
  // The 기준 일정 (or picked situation, untitled) with its own 종류 and 격식
  // 수준, and the pieces at that 격식 수준, even when 대화로 수정하기 asked
  // for another.
  | { factor: "event"; clothes: Clothing[]; facts: Basis & { title: string | null } }
  // Every color of the 코디, and those of them that are not neutral.
  | { factor: "color"; clothes: Clothing[]; facts: { colors: string[]; accents: string[] } }
  // The style most of the 코디 shares, and the pieces in it.
  | { factor: "style"; clothes: Clothing[]; facts: { style: Style } }
  // The user's preferred colors and styles that the pieces match.
  | { factor: "preference"; clothes: Clothing[]; facts: { colors: string[]; styles: Style[] } }
  // The pieces not worn in the last `days` days.
  // `estimated`: the pieces among them judged by the 추정 착용 빈도, not a
  // 착용 기록, so no day count is claimed for them.
  | { factor: "recency"; clothes: Clothing[]; facts: { days: number; estimated: string[] } }
  // The pieces not worn for at least `days` days, or never.
  | { factor: "utilization"; clothes: Clothing[]; facts: { days: number; estimated: string[] } };

// One 추천 이유: its 근거, and the 근거 as a sentence for the user.
export type Reason = { evidence: Evidence; sentence: string };

// How many 추천 이유 a 코디 comes with, at most, and at least when as many
// factors added to its score.
const MAX_REASONS = 3;
const MIN_REASONS = 2;

// Every user starts from these; 추천 맞춤 moves each within bounds.
export const DEFAULT_WEIGHTS: Required<Scores> = {
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

// How much of the 일정 score a piece loses when it is two 격식 수준 off every
// other 일정 of the day. Less than a level's worth, so the 기준 일정 comes first.
const OTHER_EVENT_PENALTY = 0.25;

export const FORMALITY_LEVEL: Record<Formality, number> = { casual: 0, "semi-formal": 1, formal: 2 };

// What a 코디 is scored against.
export type ScoringFacts = {
  basis: Basis | null;
  // The 기준 일정's title when the basis is its judgement, else null.
  basisTitle: string | null;
  // The 격식 수준 of the day's judged 일정 other than the 기준 일정.
  otherFormalities: Formality[];
  weather: Weather | null;
  preferences: Preferences;
  // The user's 추천 맞춤 weights for each factor.
  weights: Required<Scores>;
  // Per clothing id, days since its latest 착용 기록, or as its 추정 착용
  // 빈도 suggests when it has none. Absent if never worn.
  daysSinceWorn: Map<string, number>;
  // The clothing ids whose daysSinceWorn comes from the 추정 착용 빈도.
  estimated: Set<string>;
};

export function score(
  outfit: Outfit,
  { basis, otherFormalities, weather, preferences, daysSinceWorn }: ScoringFacts,
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
    scores.event = average(items.map((c) => eventFit(c, basis.formality, otherFormalities)));
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
// the 코디 stands for, give no 근거. When that leaves fewer than
// MIN_REASONS while more factors added something, those factors give their
// partial 근거 too (see partialEvidence).
export function topEvidence(outfit: Outfit, scores: Scores, scoring: ScoringFacts): Evidence[] {
  const contribution = (factor: Factor) => scoring.weights[factor] * (scores[factor] ?? 0);
  const contributing = FACTORS.filter((factor) => contribution(factor) > 0).sort(
    (a, b) => contribution(b) - contribution(a),
  );
  const full = (factor: Factor) => {
    const found = evidenceFor(factor, outfit, scoring);
    return found && found.clothes.length ? found : null;
  };
  const enough = contributing.filter(full).length >= Math.min(MIN_REASONS, contributing.length);
  return contributing
    .flatMap((factor) => {
      const found = full(factor) ?? (enough ? null : partialEvidence(factor, outfit, scoring));
      return found ? [found] : [];
    })
    .slice(0, MAX_REASONS);
}

// The 근거 of a factor no piece of the 코디 fully stands for, from the pieces
// that did best on it, with facts that hold for them. Only for factors where
// such facts can be told: the weather (the pieces are not said to suit it
// fully), and how long ago the pieces were worn.
function partialEvidence(
  factor: Factor,
  outfit: Outfit,
  { weather, daysSinceWorn, estimated }: ScoringFacts,
): Evidence | null {
  const items = Object.values(outfit);
  const best = (value: (c: Clothing) => number) => {
    const top = Math.max(...items.map(value));
    return top > 0 ? { top, clothes: items.filter((c) => value(c) === top) } : null;
  };
  const days = (c: Clothing) => daysSinceWorn.get(c.id) ?? Infinity;
  switch (factor) {
    case "weather": {
      if (!weather) return null;
      const found = best((c) => weatherFit(c, weather));
      return found && { factor, clothes: found.clothes, facts: { temperature: weather.temperature, rain: weather.rain } };
    }
    case "recency":
    case "utilization": {
      const found = best(days);
      return (
        found && {
          factor,
          clothes: found.clothes,
          facts: { days: Math.floor(found.top), estimated: estimatedAmong(found.clothes, estimated) },
        }
      );
    }
    default:
      return null;
  }
}

function estimatedAmong(clothes: Clothing[], estimated: Set<string>) {
  return clothes.filter((c) => estimated.has(c.id)).map((c) => c.id);
}

// What made `factor` score well for the 코디, from the same facts the score
// came from. Null when the factor did not apply.
function evidenceFor(
  factor: Factor,
  outfit: Outfit,
  { basis, basisTitle, otherFormalities, weather, preferences, daysSinceWorn, estimated }: ScoringFacts,
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
      if (!basis) return null;
      return {
        factor,
        clothes: items.filter((c) => eventFit(c, basis.formality, otherFormalities) === 1),
        facts: { kind: basis.kind, formality: basis.formality, title: basisTitle },
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
    case "recency": {
      const clothes = items.filter((c) => days(c) >= RECENT_DAYS);
      return { factor, clothes, facts: { days: RECENT_DAYS, estimated: estimatedAmong(clothes, estimated) } };
    }
    case "utilization": {
      const clothes = items.filter((c) => days(c) >= LONG_UNWORN_DAYS);
      return { factor, clothes, facts: { days: LONG_UNWORN_DAYS, estimated: estimatedAmong(clothes, estimated) } };
    }
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

// How well one piece suits the day: its 두께 against the 기온, halved when it
// is not worn in the 계절 the 기온 is of, and, on a rainy day, whether its
// 소재 stands up to rain.
function weatherFit(clothing: Clothing, { temperature, rain }: Weather) {
  if (rain && RAIN_WEAK_MATERIALS.has(clothing.material)) return 0;
  const target = clothing.slot === "outer" ? outerWarmth(temperature) : baseWarmth(temperature);
  const fit = 1 - Math.abs(clothing.warmth - target) / 2;
  const seasons = seasonsOf(temperature);
  const inSeason = !clothing.seasons.length || clothing.seasons.some((s) => seasons.includes(s));
  return inSeason ? fit : fit / 2;
}

// The 계절 whose clothes suit the 기온 (°C). Neighbouring 계절 overlap, so
// clothes of either suit the days between them.
function seasonsOf(temperature: number): Season[] {
  const seasons: Season[] = [];
  if (temperature >= 20) seasons.push("summer");
  if (temperature >= 8 && temperature < 23) seasons.push("spring", "autumn");
  if (temperature < 12) seasons.push("winter");
  return seasons;
}

// The 두께 that suits the 기온 for what is worn under any 아우터.
function baseWarmth(temperature: number) {
  return temperature >= 23 ? 1 : temperature >= 10 ? 2 : 3;
}

// The 두께 that suits the 기온 for an 아우터.
function outerWarmth(temperature: number) {
  return temperature >= 12 ? 1 : temperature >= 5 ? 2 : 3;
}

export function total(scores: Scores, weights: Required<Scores>) {
  return Object.entries(scores).reduce(
    (sum, [factor, value]) => sum + weights[factor as keyof Scores] * value,
    0,
  );
}

// Every complete 코디 the 옷장 can make: 상의·하의·신발, or 원피스·신발, each
// with an 아우터 when one is needed and the 옷장 has any.
export function candidateOutfits(clothes: Clothing[], needsOuter: boolean): Outfit[] {
  const of = (slot: Clothing["slot"]) => clothes.filter((c) => c.slot === slot);
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

// A 코디 counts as well matched, for the 옷장 분석 and 이 한 벌 제안, when
// both its color and its style scores reach this.
const WELL_MATCHED = 0.7;

export function isWellMatched(items: Clothing[]) {
  return colorHarmony(items) >= WELL_MATCHED && styleConsistency(items) >= WELL_MATCHED;
}

export function colorHarmony(items: Clothing[]) {
  const accents = new Set(items.map((c) => c.color).filter((color) => !NEUTRAL_COLORS.has(color)));
  return accents.size <= 1 ? 1 : accents.size === 2 ? 0.5 : 0;
}

// The share of the 코디 in its most common style.
export function styleConsistency(items: Clothing[]) {
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
export function maxBy<T>(items: T[], key: (item: T) => number): T | undefined {
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
