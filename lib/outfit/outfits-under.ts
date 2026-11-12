// Which 코디 the clothes can make for the day: at a 격식 수준, under the 수정
// 조건, with 입기 싫은 옷 left out. Both the 코디 추천 and the 구매 추천 choose
// among these.
import type { Clothing, Formality } from "./wardrobe";
import type { Weather } from "./ports";
import { candidateOutfits, FORMALITY_LEVEL } from "./scoring";
import { hasColorDirection, type RevisionCondition } from "./revision";

// Below this 기온 (°C) the 코디 gets an 아우터.
const OUTER_BELOW = 17;

// Every 코디 the 옷장 can make for the day at `formality` under the 수정 조건,
// and the clothes they may be made of. Under a 색상 방향 every 코디 has a
// piece in it, so none when the 옷장 has no such piece to wear.
export function outfitsUnder(
  wardrobeClothes: Clothing[],
  weather: Weather | null,
  formality: Formality | null,
  conditions: RevisionCondition[],
  // 입기 싫은 옷, left out unless a condition keeps them.
  excluded: Set<string> = new Set(),
  // An 아우터 is wanted whatever the weather (a 구매 조건 asked for one).
  wantsOuter = false,
) {
  const kept = wardrobeClothes.filter((c) =>
    conditions.some((condition) => condition.type === "keep" && condition.clothing.id === c.id),
  );
  const color = conditions.find((c) => c.type === "color");
  const clothes = conditioned(
    wardrobeClothes.filter((c) => !excluded.has(c.id) || kept.includes(c)),
    formality,
    conditions,
  );
  const needsOuter =
    wantsOuter ||
    (weather !== null && weather.temperature < OUTER_BELOW) ||
    kept.some((c) => c.slot === "outer");
  const candidates = candidateOutfits(clothes, needsOuter).filter(
    (outfit) =>
      kept.every((c) => Object.values(outfit).includes(c)) &&
      (!color || Object.values(outfit).some((c) => hasColorDirection(c.color, color.direction))),
  );
  return { clothes, candidates };
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
