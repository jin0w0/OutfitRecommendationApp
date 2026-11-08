import type { RevisionCondition, StyleDirection } from "@/lib/outfit/recommender";
import type { Slot } from "@/lib/outfit/wardrobe";

export const SLOT_NAMES: Record<Slot, string> = {
  top: "상의",
  bottom: "하의",
  dress: "원피스",
  outer: "아우터",
  shoes: "신발",
};

export function isSlot(value: unknown): value is Slot {
  return typeof value === "string" && Object.hasOwn(SLOT_NAMES, value);
}

// A 수정 조건 as the user would say it.
export function conditionLabel(condition: RevisionCondition) {
  switch (condition.type) {
    case "style":
      return condition.direction === "casual" ? "더 캐주얼하게" : "더 포멀하게";
    case "color":
      return condition.direction === "lighter" ? "더 밝은 색으로" : "더 어두운 색으로";
    case "exclude":
      return `${condition.clothing.name} 빼기`;
    case "keep":
      return `${condition.clothing.name} 꼭 입기`;
  }
}

// What the home screen says about the last 대화 message when it changed nothing.
//   revision-failed: the LLM could not read it
//   off-topic: 무관한 메시지, so the user is asked to talk about the 코디
//   unknown-clothing: it named a piece not found in the 옷장
//   unbuildable: 구성 불가, with the 수정 조건 (as labels) that could not be met
//   style-limit: the 코디 cannot go further in the 스타일 방향 asked for
export type RevisionNotice =
  | { type: "revision-failed" }
  | { type: "off-topic" }
  | { type: "unknown-clothing" }
  | { type: "style-limit"; direction: StyleDirection }
  | { type: "unbuildable"; unmet: string[]; missingSlots: Slot[] };
