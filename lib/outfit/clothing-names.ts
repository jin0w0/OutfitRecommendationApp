// What each clothing value is called on screen.
import type { EstimatedWearFrequency, Material, Season, Slot } from "./wardrobe";

export { COLOR_NAMES, STYLE_NAMES } from "./reasons";
export { FORMALITY_NAMES } from "./situations";

export const SLOT_NAMES: Record<Slot, string> = {
  top: "상의",
  bottom: "하의",
  dress: "원피스",
  outer: "아우터",
  shoes: "신발",
};

export const SEASON_NAMES: Record<Season, string> = {
  spring: "봄",
  summer: "여름",
  autumn: "가을",
  winter: "겨울",
};

export const MATERIAL_NAMES: Record<Material, string> = {
  cotton: "면",
  linen: "린넨",
  denim: "데님",
  wool: "울",
  knit: "니트",
  leather: "가죽",
  suede: "스웨이드",
  canvas: "캔버스",
  synthetic: "합성섬유",
};

export const WARMTH_NAMES: Record<1 | 2 | 3, string> = { 1: "얇음", 2: "보통", 3: "두꺼움" };

export const ESTIMATED_WEAR_FREQUENCY_NAMES: Record<EstimatedWearFrequency, string> = {
  weekly: "거의 매주",
  monthly: "한 달에 몇 번",
  rarely: "거의 안 입음",
  new: "새로 산 옷",
};
