// 이 한 벌 제안: a piece the 옷장 lacks (가상의 옷), suggested only when it
// would bring well-matched 코디 with clothes the user already has. The LLM
// proposes candidates; the same score rules as the 옷장 분석 decide which
// count, so every suggestion says how many new 코디 it brings.
import { createHash } from "node:crypto";
import { validClothingFields } from "./closet";
import { addDays, todayInKorea } from "./dates";
import type { PieceStore } from "./one-more-piece-store";
import type { PieceRequest } from "./purchase";
import { candidateOutfits, isWellMatched } from "./scoring";
import {
  suitsLine,
  type Clothing,
  type ClothingFields,
  type ClothingLine,
  type Formality,
  type Preferences,
  type Slot,
  type Wardrobe,
} from "./wardrobe";

// How many new well-matched 코디 a piece must bring to be suggested.
const TO_REVIVE = 2;
const TO_FILL = 1;
// How many suggestions are shown at most.
const MAX_SUGGESTIONS = 3;
// How long 관심 없어요 hides a suggestion.
const DISMISS_DAYS = 90;

// The day a 구매 추천 is for, as the LLM is told about it.
export type DayConditions = { formality: Formality | null; temperature: number | null; rain: boolean | null };

// What the LLM is asked to suggest a piece for: a piece of the 옷장 to bring
// back into use, a 종류 the 옷장 has none of, or a day (구매 추천).
// With a 구매 대화, the day comes with what the 구매 조건 ask of the pieces.
export type PieceTarget =
  | { revive: ClothingFields }
  | { fill: Slot }
  | { day: DayConditions; request?: PieceRequest };

// What the LLM is told of the user's taste: the 선호 색상·스타일 and the
// 추천받을 옷 구분 (null when not chosen).
export type AdviserPreferences = Preferences & { line: ClothingLine | null };

// The 한 벌 후보 어댑터: candidate pieces for the target, unchecked.
export type PieceAdviser = {
  proposePieces(request: {
    target: PieceTarget;
    wardrobe: ClothingFields[];
    preferences: AdviserPreferences;
  }): Promise<unknown[]>;
  // Whole 코디 of pieces the user does not have, for the day: each { pieces }.
  proposeOutfits(request: { day: DayConditions; preferences: AdviserPreferences }): Promise<unknown[]>;
};

export type PieceSuggestion =
  | { id: string; kind: "new"; piece: ClothingFields; newOutfits: number }
  // A 정리한 옷 that would do just as well: restore it instead of buying.
  | { id: string; kind: "restore"; clothing: Clothing; newOutfits: number };

export function createPieceSuggestions({
  wardrobe,
  adviser,
  store,
  today = todayInKorea,
}: {
  wardrobe: Pick<Wardrobe, "clothes" | "tidiedClothes" | "preferences" | "clothingLine">;
  adviser: PieceAdviser;
  store: PieceStore;
  today?: () => string;
}) {
  return {
    // The pieces that would bring the user's piece `clothingId` back into
    // use (for 조합 부족).
    async reviving(userId: string, clothingId: string): Promise<PieceSuggestion[]> {
      const clothes = await wardrobe.clothes(userId);
      const piece = clothes.find((c) => c.id === clothingId);
      if (!piece) return [];
      return suggest(userId, clothingId, { revive: fieldsOf(piece) }, (candidate) => {
        if (candidate.slot === piece.slot) return 0;
        return newOutfits(clothes, candidate, (outfit) => outfit.some((c) => c.id === piece.id));
      });
    },

    // The pieces of the 종류 `slot` that would let the 옷장 make 코디 (for 구성 불가).
    async filling(userId: string, slot: Slot): Promise<PieceSuggestion[]> {
      const clothes = await wardrobe.clothes(userId);
      return suggest(userId, `slot:${slot}`, { fill: slot }, (candidate) =>
        candidate.slot === slot ? newOutfits(clothes, candidate, () => true) : 0,
      );
    },

    // 관심 없어요: the suggestion `suggestionId` is hidden for DISMISS_DAYS.
    async dismiss(userId: string, suggestionId: string) {
      await store.dismiss(userId, suggestionId, addDays(today(), DISMISS_DAYS));
    },
  };

  // The checked candidates for the target, as suggestions: those bringing
  // enough new 코디 (`brings` counts them), most first, one per 종류 and color,
  // none like a piece already in the 옷장, and restoring a 정리한 옷 instead
  // of buying where one would do.
  async function suggest(
    userId: string,
    targetKey: string,
    target: PieceTarget,
    brings: (candidate: ClothingFields) => number,
  ): Promise<PieceSuggestion[]> {
    const [clothes, tidied, preferences, line, dismissed] = await Promise.all([
      wardrobe.clothes(userId),
      wardrobe.tidiedClothes(userId),
      wardrobe.preferences(userId),
      wardrobe.clothingLine(userId),
      store.dismissedOn(userId, today()),
    ]);
    const candidates = (
      await candidatesFor(userId, targetKey, target, clothes, tidied, { ...preferences, line })
    ).filter((candidate) => suitsLine(candidate.slot, line));
    const needed = "revive" in target ? TO_REVIVE : TO_FILL;

    const suggestions: PieceSuggestion[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const looks = `${candidate.slot}|${candidate.color}`;
      if (seen.has(looks) || clothes.some((c) => isLike(c, candidate))) continue;
      const id = suggestionId(targetKey, candidate);
      if (dismissed.has(id)) continue;
      const count = brings(candidate);
      if (count < needed) continue;
      seen.add(looks);
      const restorable = tidied.find((c) => isLike(c, candidate));
      suggestions.push(
        restorable
          ? { id, kind: "restore", clothing: restorable, newOutfits: count }
          : { id, kind: "new", piece: candidate, newOutfits: count },
      );
    }
    // Most new 코디 first; equals keep the LLM's order.
    return suggestions.sort((a, b) => b.newOutfits - a.newOutfits).slice(0, MAX_SUGGESTIONS);
  }

  // The LLM's checked candidates for the target: saved ones while the 옷장 is
  // as it was, else asked anew. None when the LLM fails.
  async function candidatesFor(
    userId: string,
    targetKey: string,
    target: PieceTarget,
    clothes: Clothing[],
    tidied: Clothing[],
    preferences: AdviserPreferences,
  ): Promise<ClothingFields[]> {
    const fingerprint = fingerprintOf(clothes, tidied, preferences.line);
    let raw = await store.candidates(userId, targetKey, fingerprint);
    if (!raw) {
      try {
        raw = await adviser.proposePieces({ target, wardrobe: clothes.map(fieldsOf), preferences });
      } catch (error) {
        console.error("Could not get 한 벌 후보 from the LLM", error);
        return [];
      }
      await store.saveCandidates(userId, targetKey, fingerprint, raw);
    }
    return raw.flatMap((candidate) => validClothingFields(candidate) ?? []);
  }
}

export type PieceSuggestions = ReturnType<typeof createPieceSuggestions>;

// How many well-matched 코디 the 옷장 could make with `candidate` in it,
// among those `counts` picks.
function newOutfits(clothes: Clothing[], candidate: ClothingFields, counts: (outfit: Clothing[]) => boolean) {
  const virtual: Clothing = { id: "가상의 옷", ...candidate, hasPhoto: false, estimatedWearFrequency: null };
  const withIt = [...clothes, virtual];
  const needsOuter = candidate.slot === "outer";
  return candidateOutfits(withIt, needsOuter)
    .map((outfit) => Object.values(outfit))
    .filter((items) => items.includes(virtual) && counts(items) && isWellMatched(items)).length;
}

// What names a suggestion for 관심 없어요: the target (for reviving a piece,
// its clothing id) and what the candidate looks like.
export function suggestionId(targetKey: string, candidate: ClothingFields) {
  return `${targetKey}|${candidate.slot}|${candidate.color}|${candidate.style}|${candidate.formality}`;
}

// Alike enough that having one, the other would be a 중복 구매.
export function isLike(clothing: Clothing, candidate: ClothingFields) {
  return (
    clothing.slot === candidate.slot &&
    clothing.color === candidate.color &&
    clothing.formality === candidate.formality
  );
}

export function fieldsOf({ name, slot, color, seasons, style, formality, warmth, material }: Clothing): ClothingFields {
  return { name, slot, color, seasons, style, formality, warmth, material };
}

// Changes whenever a piece is added, changed, 정리 or restored, or the
// 추천받을 옷 구분 is chosen or changed.
export function fingerprintOf(clothes: Clothing[], tidied: Clothing[], line: ClothingLine | null = null) {
  const describe = (list: Clothing[]) =>
    list
      .map(fieldsOf)
      .map((fields, i) => JSON.stringify([list[i].id, fields]))
      .sort();
  return createHash("sha256")
    .update(JSON.stringify(line ? [describe(clothes), describe(tidied), line] : [describe(clothes), describe(tidied)]))
    .digest("hex");
}
