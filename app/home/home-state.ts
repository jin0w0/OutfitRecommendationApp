// What the home screen keeps in its URL (the date, the 코디 already shown, and
// why the last 대화 message changed nothing) and how it names slots and 수정
// 조건. The page, its server actions and its components all go through here.
import { isDate, todayInKorea } from "@/lib/outfit/dates";
import type { Recommendation, RevisionCondition, StyleDirection } from "@/lib/outfit/recommender";
import type { Slot } from "@/lib/outfit/wardrobe";

type SearchParams = Record<string, string | string[] | undefined>;

export const SLOT_NAMES: Record<Slot, string> = {
  top: "상의",
  bottom: "하의",
  dress: "원피스",
  outer: "아우터",
  shoes: "신발",
};

function isSlot(value: unknown): value is Slot {
  return typeof value === "string" && Object.hasOwn(SLOT_NAMES, value);
}

// Slots as the user reads them in a sentence: "상의, 신발".
export function slotNames(slots: Slot[]) {
  return slots.map((slot) => SLOT_NAMES[slot]).join(", ");
}

// Per kind of 수정 조건: how the user would say it, and what tells it apart
// from the others in a list.
const CONDITIONS: {
  [T in RevisionCondition["type"]]: {
    label(condition: Extract<RevisionCondition, { type: T }>): string;
    key(condition: Extract<RevisionCondition, { type: T }>): string;
  };
} = {
  style: {
    label: ({ direction }) => (direction === "casual" ? "더 캐주얼하게" : "더 포멀하게"),
    key: () => "style",
  },
  color: {
    label: ({ direction }) => (direction === "lighter" ? "더 밝은 색으로" : "더 어두운 색으로"),
    key: () => "color",
  },
  exclude: { label: ({ clothing }) => `${clothing.name} 빼기`, key: ({ clothing }) => `exclude:${clothing.id}` },
  keep: { label: ({ clothing }) => `${clothing.name} 꼭 입기`, key: ({ clothing }) => `keep:${clothing.id}` },
};

type ConditionText = { label(condition: RevisionCondition): string; key(condition: RevisionCondition): string };

export function conditionLabel(condition: RevisionCondition) {
  return (CONDITIONS[condition.type] as ConditionText).label(condition);
}

export function conditionKey(condition: RevisionCondition) {
  return (CONDITIONS[condition.type] as ConditionText).key(condition);
}

// The date the home screen is for: the one in the URL, else today.
export function homeDate(value: unknown) {
  return isDate(value) ? value : todayInKorea();
}

// The date a home screen form was sent for.
export function formDate(formData: FormData) {
  const date = formData.get("date");
  if (!isDate(date)) throw new Error("Invalid date");
  return date;
}

// 코디 already shown for the date (다시 추천받기), each as clothing ids; in the
// URL each is its ids joined by dots.
export function shownFrom(params: SearchParams): string[][] {
  return [params.shown ?? []].flat().map((outfit) => outfit.split("."));
}

export function shownParams(shown: string[][]) {
  return [...new Set(shown.map((ids) => ids.join(".")))];
}

// The steps the 되돌리기 buttons go back to from `step`: one back, and the
// first 추천.
export function undoTargets(step: number) {
  return step > 1 ? [step - 1, 0] : step === 1 ? [0] : [];
}

// What the home screen says about the last 대화 message when it changed nothing.
//   revision-failed: the LLM could not read it
//   off-topic: 무관한 메시지, so the user is asked to talk about the 코디
//   unknown-clothing: it named a piece not found in the 옷장
//   style-limit: the 코디 cannot go further in the 스타일 방향 asked for
//   unbuildable: 구성 불가, with the 수정 조건 (as labels) that could not be met
export type RevisionNotice =
  | { type: "revision-failed" }
  | { type: "off-topic" }
  | { type: "unknown-clothing" }
  | { type: "style-limit"; direction: StyleDirection }
  | { type: "unbuildable"; unmet: string[]; missingSlots: Slot[] };

// The notice for a 대화로 수정하기 result, as URL parameters; none when the
// message was applied. The 추천 세션 keeps no step for a message that changed
// nothing, so the URL carries why.
export function noticeParams(revised: Recommendation): [string, string][] {
  if (revised.missing.includes("revision-llm-failed")) return [["notice", "revision-failed"]];
  const { unapplied } = revised;
  switch (unapplied?.reason) {
    case undefined:
      return [];
    case "off-topic":
    case "unknown-clothing":
      return [["notice", unapplied.reason]];
    case "style-limit":
      return [
        ["notice", "style-limit"],
        ["direction", unapplied.direction],
      ];
    case "unbuildable":
      return [
        ["notice", "unbuildable"],
        ...unapplied.unmet.map((c): [string, string] => ["unmet", conditionLabel(c)]),
        ...unapplied.missingSlots.map((slot): [string, string] => ["missingSlot", slot]),
      ];
  }
}

// The notice noticeParams put in the URL, if any.
export function noticeFrom(params: SearchParams): RevisionNotice | null {
  switch (params.notice) {
    case "revision-failed":
    case "off-topic":
    case "unknown-clothing":
      return { type: params.notice };
    case "style-limit":
      return params.direction === "casual" || params.direction === "formal"
        ? { type: "style-limit", direction: params.direction }
        : null;
    case "unbuildable":
      return {
        type: "unbuildable",
        unmet: [params.unmet ?? []].flat(),
        missingSlots: [params.missingSlot ?? []].flat().filter(isSlot),
      };
    default:
      return null;
  }
}

export function noticeText(notice: RevisionNotice) {
  switch (notice.type) {
    case "revision-failed":
      return "요청을 이해하지 못해 코디를 그대로 두었어요. 다시 말씀해 주세요.";
    case "off-topic":
      return "코디와 관련된 요청만 도와드릴 수 있어요. 예: 좀 더 캐주얼하게, 이 바지 말고 다른 걸로";
    case "unknown-clothing":
      return "말씀하신 옷을 옷장에서 찾지 못해 코디를 그대로 두었어요. 옷 이름으로 다시 말씀해 주세요.";
    case "style-limit":
      return `이 일정에서는 지금보다 더 ${notice.direction === "casual" ? "캐주얼하게" : "포멀하게"} 바꿀 수 없어요. 코디는 그대로 두었어요.`;
    case "unbuildable": {
      const slots = notice.missingSlots.length ? ` (${slotNames(notice.missingSlots)}이(가) 부족해요)` : "";
      return `옷장의 옷으로는 "${notice.unmet.join(", ")}" 조건을 만족하는 코디를 만들 수 없어요${slots}. 코디는 그대로 두었어요.`;
    }
  }
}
