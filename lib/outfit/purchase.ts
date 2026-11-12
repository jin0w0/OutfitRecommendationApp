// 구매 추천 코디 and 구매 대화: what a 구매 추천 코디 is, the 구매 조건 a 대화
// message asks for and how they add up, and how the 코디 are chosen under
// them. The 코디 추천 module finds the day and asks the LLM; this decides.
import { validClothingFields } from "./closet";
import { COLOR_NAMES, MATERIAL_NAMES, SLOT_NAMES } from "./clothing-names";
import { isLike } from "./one-more-piece";
import { outfitsUnder } from "./outfits-under";
import type { Weather } from "./ports";
import { hasColorDirection, type ColorDirection, type RevisionCondition, type StyleDirection } from "./revision";
import { candidateOutfits, isWellMatched, type Outfit } from "./scoring";
import {
  suitsLine,
  type Clothing,
  type ClothingFields,
  type ClothingLine,
  type Color,
  type Formality,
  type Material,
  type Slot,
} from "./wardrobe";

// How many 구매 추천 코디 are shown at most.
export const PURCHASE_OUTFITS = 3;

// A piece a 구매 추천 코디 adds to the owned clothes: a 가상의 옷 to buy, or a
// 정리한 옷 to restore instead; and how many owned pieces it goes well with.
export type AddedPiece = { kind: "new" | "restore"; clothing: Clothing; matchesOwned: number };

// One 구매 추천 코디: owned clothes and the pieces added to them.
export type PurchaseOutfit = { outfit: Outfit; added: AddedPiece[] };

//   with-wardrobe: owned clothes with pieces added
//   all-new: only new pieces, as the 옷장 made no 코디 for the day
//   unavailable: the LLM failed, so none could be made
export type PurchaseOutfits =
  | { kind: "with-wardrobe" | "all-new"; outfits: PurchaseOutfit[] }
  | { kind: "unavailable" };

// One 구매 조건 asked for in 구매 대화.
//   slots: the 종류 of the new pieces, one new piece each; or all new
//   color / color-name: new pieces in that 색 방향, or of that color
//   material: new pieces of that 소재
//   style: the 격식 수준 one level that way
//   keep / exclude: always or never this piece; `isNew` for a piece the
//     구매 추천 added (a 가상의 옷 or 정리한 옷) rather than an owned one
export type PurchaseCondition =
  | { type: "slots"; slots: Slot[] | "all" }
  | { type: "color"; direction: ColorDirection }
  | { type: "color-name"; color: Color }
  | { type: "material"; material: Material }
  | { type: "style"; direction: StyleDirection }
  | { type: "keep" | "exclude"; clothing: Clothing; isNew: boolean };

// A 구매 조건 as the LLM answers it, naming pieces by id, or off-topic for a
// message that has nothing to do with the 구매 추천 (무관한 메시지).
export type AskedPurchaseCondition =
  | Extract<PurchaseCondition, { type: "slots" | "color" | "color-name" | "material" | "style" }>
  | { type: "keep" | "exclude"; clothingId: string }
  | { type: "off-topic" };

// What the LLM is told to read a 구매 대화 message: the 구매 추천 코디 shown,
// which of their pieces are added, and the whole 옷장.
export type PurchaseRequest = {
  message: string;
  outfits: Clothing[][];
  addedIds: string[];
  wardrobe: Clothing[];
};

// What a 비서 답장 may say: the message, the 구매 조건 so far (as labels) and
// the 코디 chosen.
export type PurchaseReplyFacts = {
  message: string;
  conditions: string[];
  outfits: { added: { name: string; matchesOwned: number; restore: boolean }[]; owned: string[] }[];
};

// What the LLM is asked to suggest new pieces under, besides the day.
export type PieceRequest = {
  slots: Slot[] | "all" | null;
  color: ColorDirection | Color | null;
  material: Material | null;
};

// The 구매 조건 the LLM answered, with the pieces they name from the 옷장 or
// the 코디 shown, and whether any named a piece neither has (dropped).
export function resolvedPurchase(asked: AskedPurchaseCondition[], owned: Clothing[], shown: PurchaseOutfit[]) {
  let unknownClothing = false;
  const added = shown.flatMap((o) => o.added.map((a) => a.clothing));
  const conditions = asked.flatMap((c): PurchaseCondition[] => {
    if (c.type === "off-topic") return [];
    if (!("clothingId" in c)) return [c];
    const ownedPiece = owned.find(({ id }) => id === c.clothingId);
    if (ownedPiece) return [{ type: c.type, clothing: ownedPiece, isNew: false }];
    const addedPiece = added.find(({ id }) => id === c.clothingId);
    if (addedPiece) return [{ type: c.type, clothing: addedPiece, isNew: true }];
    unknownClothing = true;
    return [];
  });
  return { conditions, unknownClothing };
}

// The 구매 조건 so far with `asked` added after them. A new condition replaces
// an earlier one of the same kind (the two 색 kinds count as one), and any
// earlier condition on the same piece.
export function accumulatePurchase(earlier: PurchaseCondition[], asked: PurchaseCondition[]) {
  const kind = (c: PurchaseCondition) => (c.type === "color-name" ? "color" : c.type);
  const clash = (a: PurchaseCondition, b: PurchaseCondition) => {
    if ((a.type === "keep" || a.type === "exclude") && (b.type === "keep" || b.type === "exclude")) {
      return a.isNew === b.isNew && (a.isNew ? sameLook(a.clothing, b.clothing) : a.clothing.id === b.clothing.id);
    }
    return kind(a) === kind(b);
  };
  let conditions = earlier;
  for (const condition of asked) {
    conditions = [...conditions.filter((c) => !clash(c, condition)), condition];
  }
  return conditions;
}

// The 스타일 방향 among the 구매 조건, as the 수정 조건 the 격식 수준 shifts by.
export function styleOf(conditions: PurchaseCondition[]): RevisionCondition[] {
  return conditions.flatMap((c) => (c.type === "style" ? [c] : []));
}

// What the LLM is asked for new pieces under the 구매 조건.
export function pieceRequest(conditions: PurchaseCondition[]): PieceRequest {
  let color: PieceRequest["color"] = null;
  let slots: PieceRequest["slots"] = null;
  let material: Material | null = null;
  for (const c of conditions) {
    if (c.type === "color") color = c.direction;
    if (c.type === "color-name") color = c.color;
    if (c.type === "slots") slots = c.slots;
    if (c.type === "material") material = c.material;
  }
  return { slots, color, material };
}

// How the user would say the 구매 조건.
export function purchaseConditionLabel(c: PurchaseCondition): string {
  switch (c.type) {
    case "slots":
      return c.slots === "all" ? "전부 새 옷으로" : `새 ${c.slots.map((s) => SLOT_NAMES[s]).join("·")}`;
    case "color":
      return c.direction === "lighter" ? "더 밝은 색으로" : "더 어두운 색으로";
    case "color-name":
      return `${COLOR_NAMES[c.color]}으로`;
    case "material":
      return `${MATERIAL_NAMES[c.material]} 소재로`;
    case "style":
      return c.direction === "casual" ? "더 캐주얼하게" : "더 포멀하게";
    case "keep":
      return c.isNew ? `${c.clothing.name} 남기기` : `${c.clothing.name} 꼭 입기`;
    case "exclude":
      return c.isNew ? `${c.clothing.name} 말고` : `${c.clothing.name} 빼기`;
  }
}

// What tells a 구매 조건 apart from the others in a list.
export function purchaseConditionKey(c: PurchaseCondition) {
  return c.type === "keep" || c.type === "exclude" ? `${c.type}:${c.clothing.id}` : c.type;
}

// The 비서 답장 when the LLM could not write one.
export function templateReply(facts: PurchaseReplyFacts) {
  const asked = facts.conditions.length ? `${facts.conditions.join(", ")} 요청에 맞춰 ` : "";
  const first = facts.outfits[0]?.added.find((a) => !a.restore);
  const piece = first ? ` ${first.name}을(를) 더하면 가진 옷 ${first.matchesOwned}벌과 어울려요.` : "";
  return `${asked}구매 추천 코디 ${facts.outfits.length}개를 다시 골라 봤어요.${piece}`;
}

export function replyFacts(message: string, conditions: PurchaseCondition[], outfits: PurchaseOutfit[]): PurchaseReplyFacts {
  return {
    message,
    conditions: conditions.map(purchaseConditionLabel),
    outfits: outfits.map(({ outfit, added }) => ({
      added: added.map(({ clothing, matchesOwned, kind }) => ({ name: clothing.name, matchesOwned, restore: kind === "restore" })),
      owned: Object.values(outfit)
        .filter((c) => !added.some((a) => a.clothing === c))
        .map((c) => c.name),
    })),
  };
}

// The LLM's candidates that check out, none alike twice.
export function checkedPieces(raw: unknown[]): ClothingFields[] {
  return mergedPool([], raw.flatMap((r) => validClothingFields(r) ?? []));
}

// `pool` with the pieces of `more` it has nothing alike to.
export function mergedPool(pool: ClothingFields[], more: ClothingFields[]) {
  const merged = [...pool];
  for (const piece of more) if (!merged.some((p) => sameLook(p, piece))) merged.push(piece);
  return merged;
}

// A whole new 코디 from the LLM, if every piece checks out and the 종류 make
// a 코디: 상의·하의·신발 or 원피스·신발, with an optional 아우터.
export function wholeOutfit(raw: unknown): Partial<Record<Slot, ClothingFields>> | null {
  const pieces = (raw as { pieces?: unknown[] } | null)?.pieces;
  if (!Array.isArray(pieces)) return null;
  const checked = pieces.map((p) => validClothingFields(p));
  if (checked.some((p) => p === null)) return null;
  const outfit: Partial<Record<Slot, ClothingFields>> = {};
  for (const piece of checked as ClothingFields[]) {
    if (outfit[piece.slot]) return null;
    outfit[piece.slot] = piece;
  }
  const base = outfit.dress ? !outfit.top && !outfit.bottom : outfit.top && outfit.bottom;
  return base && outfit.shoes ? outfit : null;
}

// A whole new 코디 as a 구매 추천 코디, every piece a 가상의 옷.
export function allNewOutfit(pieces: Partial<Record<Slot, ClothingFields>>, index: number): PurchaseOutfit {
  const outfit = Object.fromEntries(
    Object.entries(pieces).map(([slot, piece]) => [slot, virtual(piece, `${index}-${slot}`)]),
  ) as Outfit;
  return { outfit, added: Object.values(outfit).map((clothing) => ({ kind: "new", clothing, matchesOwned: 0 })) };
}

// The 구매 추천 코디 for the day under the 구매 조건: owned clothes with pieces
// from `pool` added, the best scored first, no two adding the same pieces.
//   Added pieces suit the 추천받을 옷 구분, even when kept, and are of the day's 격식 수준 and meet the 색·소재 조건, unless
//   kept; none is like an owned piece; one like a 정리한 옷 is that 정리한 옷.
//   With 종류 asked for, exactly those are added; else as few as can be
//   (just one with `exactlyOne`).
export function choosePurchaseOutfits({
  owned,
  tidied,
  pool,
  conditions,
  formality,
  weather,
  disliked,
  scoreOf,
  exactlyOne = false,
  line = null,
}: {
  owned: Clothing[];
  tidied: Clothing[];
  pool: ClothingFields[];
  conditions: PurchaseCondition[];
  formality: Formality | null;
  weather: Weather | null;
  disliked: Set<string>;
  scoreOf: (outfit: Outfit) => number;
  exactlyOne?: boolean;
  line?: ClothingLine | null;
}): PurchaseOutfit[] {
  const keptNew = conditions.flatMap((c) => (c.type === "keep" && c.isNew ? [c.clothing] : []));
  const droppedNew = conditions.flatMap((c) => (c.type === "exclude" && c.isNew ? [c.clothing] : []));
  const ownedConditions = conditions.flatMap((c): RevisionCondition[] =>
    (c.type === "keep" || c.type === "exclude") && !c.isNew ? [{ type: c.type, clothing: c.clothing }] : [],
  );
  const slots = conditions.findLast((c) => c.type === "slots")?.slots ?? null;
  const color = conditions.findLast((c) => c.type === "color" || c.type === "color-name");
  const material = conditions.findLast((c) => c.type === "material")?.material ?? null;

  const meets = (piece: ClothingFields) =>
    (!formality || piece.formality === formality) &&
    (!material || piece.material === material) &&
    (!color ||
      (color.type === "color" ? hasColorDirection(piece.color, color.direction) : piece.color === color.color)) &&
    (!Array.isArray(slots) || slots.includes(piece.slot));

  const added: Clothing[] = [];
  const keptAdded: Clothing[] = [];
  for (const [index, piece] of pool.entries()) {
    if (owned.some((c) => isLike(c, piece)) || !suitsLine(piece.slot, line)) continue;
    const kept = keptNew.some((k) => sameLook(k, piece));
    if (!kept && (droppedNew.some((d) => sameLook(d, piece)) || !meets(piece))) continue;
    const clothing = tidied.find((c) => isLike(c, piece)) ?? virtual(piece, String(index));
    added.push(clothing);
    if (kept) keptAdded.push(clothing);
  }
  // Every kept piece must still be there to keep.
  if (keptAdded.length < keptNew.length) return [];

  const keptOwnedIds = new Set(ownedConditions.flatMap((c) => (c.type === "keep" ? [c.clothing.id] : [])));
  const newSlots = new Set<Slot>([...(Array.isArray(slots) ? slots : []), ...keptAdded.map((c) => c.slot)]);
  const usable = owned.filter(
    (c) => keptOwnedIds.has(c.id) || (slots !== "all" && !newSlots.has(c.slot)),
  );
  const { candidates } = outfitsUnder(
    [...usable, ...added],
    weather,
    formality,
    [...ownedConditions, ...keptAdded.map((clothing) => ({ type: "keep" as const, clothing }))],
    disliked,
    newSlots.has("outer"),
  );
  const isAdded = (c: Clothing) => added.includes(c);
  let fitting = candidates
    .map((outfit) => ({ outfit, addedHere: Object.values(outfit).filter(isAdded) }))
    .filter(({ outfit, addedHere }) => {
      if (!addedHere.length) return false;
      if (slots === "all") return Object.values(outfit).every((c) => isAdded(c) || keptOwnedIds.has(c.id));
      return newSlots.size === 0 || addedHere.every((c) => newSlots.has(c.slot));
    });
  if (!newSlots.size && slots !== "all") {
    const fewest = exactlyOne ? 1 : Math.min(...fitting.map(({ addedHere }) => addedHere.length));
    fitting = fitting.filter(({ addedHere }) => addedHere.length === fewest);
  }

  const seen = new Set<string>();
  return fitting
    .map((item) => ({ ...item, total: scoreOf(item.outfit) }))
    .sort((a, b) => b.total - a.total)
    .filter(({ addedHere }) => {
      const looks = addedHere
        .map((c) => (c.id.startsWith(VIRTUAL) ? `${c.slot}|${c.color}` : c.id))
        .sort()
        .join();
      if (seen.has(looks)) return false;
      seen.add(looks);
      return true;
    })
    .slice(0, PURCHASE_OUTFITS)
    .map(({ outfit, addedHere }) => ({
      outfit,
      added: addedHere.map((clothing) => ({
        kind: clothing.id.startsWith(VIRTUAL) ? ("new" as const) : ("restore" as const),
        clothing,
        matchesOwned: ownedGoingWith(owned, clothing),
      })),
    }));
}

const VIRTUAL = "가상의 옷";

function virtual(piece: ClothingFields, key: string): Clothing {
  return { id: `${VIRTUAL} ${key}`, ...piece, hasPhoto: false, estimatedWearFrequency: null };
}

// The same piece, as far as the 구매 추천 tells pieces apart.
function sameLook(a: ClothingFields, b: ClothingFields) {
  return a.slot === b.slot && a.color === b.color && a.formality === b.formality && a.material === b.material && a.style === b.style;
}

// How many owned pieces go well with `added` in some well-matched 코디.
function ownedGoingWith(clothes: Clothing[], added: Clothing) {
  const owned = new Set<string>();
  for (const outfit of candidateOutfits([...clothes, added], added.slot === "outer")) {
    const items = Object.values(outfit);
    if (!items.includes(added) || !isWellMatched(items)) continue;
    for (const item of items) if (item !== added) owned.add(item.id);
  }
  return owned.size;
}
