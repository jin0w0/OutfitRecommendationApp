import type { Formality } from "./wardrobe";

// 일정의 종류, each with the 격식 수준 it usually calls for.
export const EVENT_KINDS = {
  work: { name: "출근", formality: "semi-formal" },
  school: { name: "등교", formality: "casual" },
  appointment: { name: "약속", formality: "casual" },
  date: { name: "데이트", formality: "casual" },
  workout: { name: "운동", formality: "casual" },
  interview: { name: "면접", formality: "formal" },
  wedding: { name: "결혼식", formality: "formal" },
} as const satisfies Record<string, { name: string; formality: Formality }>;

export type EventKind = keyof typeof EVENT_KINDS;

export function isEventKind(value: unknown): value is EventKind {
  return typeof value === "string" && Object.hasOwn(EVENT_KINDS, value);
}

export const FORMALITY_NAMES: Record<Formality, string> = {
  casual: "캐주얼",
  "semi-formal": "세미 포멀",
  formal: "포멀",
};
