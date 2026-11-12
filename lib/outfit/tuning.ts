// 추천 맞춤: each user's weights for the score factors, worked out every time
// from what they did (거절 with a 거절 이유, and later 수락) since they last
// went back to the start. Nothing derived is stored, so undoing a record
// undoes its effect exactly.
import { DEFAULT_WEIGHTS, type Factor } from "./scoring";
import type { RejectionReason } from "./tuning-store";

export { REJECTION_REASONS, type RejectionReason } from "./tuning-store";

// The factor each 거절 이유 asks to be minded more; the others ask nothing.
const REASON_FACTOR: Partial<Record<RejectionReason, Factor>> = {
  color: "color",
  taste: "preference",
  weather: "weather",
  event: "event",
};

// How much one 거절 makes its factor weigh, and the bounds of any factor.
const REJECTION_STEP = 1.1;
const MIN_MULTIPLIER = 0.5;
const MAX_MULTIPLIER = 2;

export type Multipliers = Record<Factor, number>;

// Each factor's weight as a multiple of its default, from the 거절 counted.
export function multipliersFrom(rejections: { reason: RejectionReason | null }[]): Multipliers {
  const counts = new Map<Factor, number>();
  for (const { reason } of rejections) {
    const factor = reason && REASON_FACTOR[reason];
    if (factor) counts.set(factor, (counts.get(factor) ?? 0) + 1);
  }
  const multipliers = {} as Multipliers;
  for (const factor of Object.keys(DEFAULT_WEIGHTS) as Factor[]) {
    const raw = REJECTION_STEP ** (counts.get(factor) ?? 0);
    const bounded = Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, raw));
    // Rounded so 1.1 reads as 1.1, not 1.1000000000000001.
    multipliers[factor] = Math.round(bounded * 10_000) / 10_000;
  }
  return multipliers;
}

export function weightsFrom(multipliers: Multipliers): Multipliers {
  const weights = {} as Multipliers;
  for (const factor of Object.keys(DEFAULT_WEIGHTS) as Factor[]) {
    weights[factor] = DEFAULT_WEIGHTS[factor] * multipliers[factor];
  }
  return weights;
}
