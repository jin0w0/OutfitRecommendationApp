// The 코디 추천 module. Callers see only its entry points; everything that goes
// into choosing a 코디 happens inside.
import { EVENT_KINDS, type EventKind } from "./situations";
import type { Clothing, Formality, Preferences, Slot, Wardrobe } from "./wardrobe";

export type Outfit = {
  top?: Clothing;
  bottom?: Clothing;
  dress?: Clothing;
  shoes: Clothing;
};

// The 일정 the 코디 is chosen for: its 일정의 종류 and 격식 수준.
export type Basis = { kind: EventKind; formality: Formality };

// 0..1 per factor. A factor that did not apply (e.g. 일정 with 일정 없음) is absent.
export type Scores = { event?: number; color: number; style: number; preference: number };

// The same defaults for every user for now.
const WEIGHTS: Required<Scores> = { event: 3, color: 2, style: 1, preference: 2 };

// Colors that go with anything; a 코디 reads well with at most one other.
const NEUTRAL_COLORS = new Set(["black", "white", "gray", "navy", "beige", "brown"]);

export type Recommendation =
  | { status: "ok"; date: string; basis: Basis | null; outfit: Outfit; scores: Scores }
  // The 옷장 has nothing to fill these slots with.
  | { status: "unbuildable"; date: string; basis: Basis | null; missingSlots: Slot[] };

const FORMALITY_LEVEL: Record<Formality, number> = { casual: 0, "semi-formal": 1, formal: 2 };

export function createOutfitRecommender({
  wardrobe,
}: {
  wardrobe: Pick<Wardrobe, "clothes" | "preferences">;
}) {
  return {
    // 날짜로 추천받기. `situation` is the 일정 the user picked, or null for 일정 없음.
    async recommendForDate({
      userId,
      date,
      situation,
    }: {
      userId: string;
      // YYYY-MM-DD
      date: string;
      situation: EventKind | null;
    }): Promise<Recommendation> {
      const basis = situation && { kind: situation, formality: EVENT_KINDS[situation].formality };
      const clothes = suitableClothes(await wardrobe.clothes(userId), basis);
      const preferences = await wardrobe.preferences(userId);
      const best = maxBy(
        candidateOutfits(clothes).map((outfit) => ({
          outfit,
          scores: score(outfit, basis, preferences),
        })),
        ({ scores }) => total(scores),
      );
      if (!best) {
        return { status: "unbuildable", date, basis, missingSlots: missingSlots(clothes) };
      }
      return { status: "ok", date, basis, ...best };
    },
  };
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

function score(outfit: Outfit, basis: Basis | null, preferences: Preferences): Scores {
  const items = Object.values(outfit);
  const scores: Scores = {
    color: colorHarmony(items),
    style: styleConsistency(items),
    preference: average(items.map((c) => preferenceMatch(c, preferences))),
  };
  if (basis) {
    scores.event = average(items.map((c) => (c.formality === basis.formality ? 1 : 0)));
  }
  return scores;
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

// Every complete 코디 the 옷장 can make: 상의·하의·신발, or 원피스·신발.
function candidateOutfits(clothes: Clothing[]): Outfit[] {
  const of = (slot: Slot) => clothes.filter((c) => c.slot === slot);
  const outfits: Outfit[] = [];
  for (const shoes of of("shoes")) {
    for (const top of of("top")) {
      for (const bottom of of("bottom")) outfits.push({ top, bottom, shoes });
    }
    for (const dress of of("dress")) outfits.push({ dress, shoes });
  }
  return outfits;
}

export type OutfitRecommender = ReturnType<typeof createOutfitRecommender>;
