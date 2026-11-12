// 대화로 수정하기's 수정 조건: what they are, how they add up over a 추천
// 세션, the 격식 수준 they move the 코디 to, and what a 수정 changed or should
// warn of.
import type { Clothing, Color, Formality, Slot } from "./wardrobe";
import type { AskedCondition } from "./ports";
import { FORMALITY_LEVEL, type Basis, type Outfit } from "./scoring";

// One 수정 조건 asked for in 대화로 수정하기.
//   style: a 격식 수준 one level below (casual) or above (formal) the one the
//     코디 was first chosen at
//   color: lighter or darker colors in every slot the 옷장 has them for, and
//     in one slot at least
//   exclude: never this piece
//   keep: always this piece (아이템 고정)
export type RevisionCondition =
  | { type: "style"; direction: StyleDirection }
  | { type: "color"; direction: ColorDirection }
  | { type: "exclude"; clothing: Clothing }
  | { type: "keep"; clothing: Clothing };

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
// in the session so far (a later one replacing any it conflicts with), how
// the 코디 differs from the one before, and what the user should be warned of
// about the 수정, which went ahead anyway.
export type Revision = {
  message: string;
  conditions: RevisionCondition[];
  changes: OutfitChange[];
  warnings: RevisionWarning[];
};

// Something about a 수정 the user should know although it was made.
//   formality-conflict: these 수정 조건 take the 코디 away from the 격식 수준
//     of the 일정 it is for (the 기준 일정, or the situation picked)
export type RevisionWarning = {
  type: "formality-conflict";
  basis: Basis;
  conditions: RevisionCondition[];
};

// A 대화 message that left the 코디 as it was.
//   unbuildable: 구성 불가. The 옷장 has no 코디 that meets `unmet` together
//     with the other 수정 조건 kept so far; `missingSlots` are the slots left
//     without clothes.
//   off-topic: 무관한 메시지. It asked nothing of the 코디.
//   unknown-clothing: it named a piece that could not be told among the
//     옷장's clothes.
//   style-limit: it asked for a 스타일 방향 the 코디 cannot go further in: past
//     the end of the 격식 수준, or again after the 코디 already went one level
//     from its 일정's.
export type UnappliedRevision =
  | { reason: "unbuildable"; message: string; unmet: RevisionCondition[]; missingSlots: Slot[] }
  | { reason: "off-topic"; message: string }
  | { reason: "unknown-clothing"; message: string }
  | { reason: "style-limit"; message: string; direction: StyleDirection };

// How every color reads for the 색상 방향 of 대화로 수정하기 and 구매 대화:
// light, dark, or neither. A color added to the 15 must be given one here.
const COLOR_TONES: Record<Color, "light" | "dark" | "neither"> = {
  white: "light",
  beige: "light",
  yellow: "light",
  pink: "light",
  orange: "light",
  skyblue: "light",
  black: "dark",
  navy: "dark",
  brown: "dark",
  gray: "dark",
  khaki: "dark",
  purple: "dark",
  red: "neither",
  green: "neither",
  blue: "neither",
};

export function hasColorDirection(color: Color, direction: ColorDirection) {
  return COLOR_TONES[color] === (direction === "lighter" ? "light" : "dark");
}

// The 수정 조건 the LLM answered, with the pieces they name from the 옷장,
// and whether any named a piece the 옷장 does not have (dropped). Off-topic
// asks nothing of the 코디, so it is dropped too.
export function resolved(asked: AskedCondition[], wardrobe: Clothing[]) {
  let unknownClothing = false;
  const conditions = asked.flatMap((c): RevisionCondition[] => {
    if (c.type === "off-topic") return [];
    if (c.type === "style" || c.type === "color") return [c];
    const clothing = wardrobe.find(({ id }) => id === c.clothingId);
    if (!clothing) unknownClothing = true;
    return clothing ? [{ type: c.type, clothing }] : [];
  });
  return { conditions, unknownClothing };
}

// The 수정 조건 so far with `asked` added after them. A new condition replaces
// any earlier one it conflicts with: another 스타일 방향 or 색상 방향, any
// condition on the same piece, or keeping another piece for the same slot.
export function accumulate(earlier: RevisionCondition[], asked: RevisionCondition[]) {
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

// `formality` one level toward the 스타일 방향 asked for, if any.
export function shifted(formality: Formality | null, conditions: RevisionCondition[]): Formality | null {
  const style = conditions.find((c) => c.type === "style");
  if (!formality || !style) return formality;
  const level = FORMALITY_LEVEL[formality] + (style.direction === "casual" ? -1 : 1);
  const levels = Object.keys(FORMALITY_LEVEL) as Formality[];
  return levels[Math.min(Math.max(level, 0), levels.length - 1)];
}

// The 격식 충돌 of the 수정 조건 with the 일정 the session's 코디 is for: a
// 스타일 방향 that moves the 코디 off its 격식 수준, and kept pieces of
// another 격식 수준.
export function warningsFor(basis: Basis | null, conditions: RevisionCondition[]): RevisionWarning[] {
  if (!basis) return [];
  const clashing = conditions.filter((c) => {
    if (c.type === "style") return shifted(basis.formality, [c]) !== basis.formality;
    if (c.type === "keep") return c.clothing.formality !== basis.formality;
    return false;
  });
  return clashing.length ? [{ type: "formality-conflict", basis, conditions: clashing }] : [];
}

const SLOTS: (keyof Outfit)[] = ["outer", "top", "bottom", "dress", "shoes"];

// The slots whose piece differs between two steps, each with the 수정 조건
// behind the change, the latest asked first.
// Nothing changed when either step has no 코디.
export function changesBetween(
  before: { status: string; outfit?: Outfit },
  after: { status: string; outfit?: Outfit },
  conditions: RevisionCondition[],
) {
  if (!before.outfit || !after.outfit) return [];
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
