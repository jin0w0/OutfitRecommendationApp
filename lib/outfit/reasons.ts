// Plain sentences for 추천 이유, made from their 근거 alone, for when the LLM
// cannot write them.
import type { Evidence } from "./recommender";
import { EVENT_KINDS, FORMALITY_NAMES } from "./situations";
import type { Clothing, Style } from "./wardrobe";

export const STYLE_NAMES: Record<Style, string> = {
  casual: "캐주얼",
  minimal: "미니멀",
  classic: "클래식",
  street: "스트릿",
  sporty: "스포티",
};

const COLOR_NAMES: Record<string, string> = {
  black: "검정",
  white: "흰색",
  gray: "회색",
  navy: "네이비",
  beige: "베이지",
  brown: "갈색",
  red: "빨강",
  blue: "파랑",
  green: "초록",
  yellow: "노랑",
  pink: "분홍",
  purple: "보라",
  orange: "주황",
  khaki: "카키",
};

export function colorName(color: string) {
  return COLOR_NAMES[color] ?? color;
}

export function templateSentence(evidence: Evidence): string {
  const names = list(evidence.clothes);
  switch (evidence.factor) {
    case "weather": {
      const { temperature, rain } = evidence.facts;
      return `기온 ${temperature}°C${rain ? ", 비 소식이 있는" : "인"} 날씨에 맞는 두께와 소재로 ${names}을(를) 골랐어요.`;
    }
    case "event": {
      const { kind, formality, title } = evidence.facts;
      const occasion = title ? `'${title}'(${EVENT_KINDS[kind].name})` : EVENT_KINDS[kind].name;
      return `${occasion} 일정에 맞춰 ${FORMALITY_NAMES[formality]} 차림인 ${names}을(를) 골랐어요.`;
    }
    case "color": {
      const { colors, accents } = evidence.facts;
      const named = colors.map(colorName).join(", ");
      if (!accents.length) return `${named}은(는) 모두 무난한 색이라 서로 잘 어울려요.`;
      if (accents.length === 1) {
        return `${named} 중 포인트 색은 ${colorName(accents[0])} 하나라 깔끔하게 어울려요.`;
      }
      return `${named} 중 포인트 색 ${accents.map(colorName).join(", ")}을(를) 무난한 색이 받쳐 줘요.`;
    }
    case "style":
      return `${names}이(가) ${STYLE_NAMES[evidence.facts.style]} 스타일로 통일감이 있어요.`;
    case "preference": {
      const liked = [...evidence.facts.colors.map(colorName), ...evidence.facts.styles.map((s) => STYLE_NAMES[s])];
      return `좋아하는 ${liked.join(", ")}에 맞는 ${names}이(가) 들어 있어요.`;
    }
    case "recency":
      return `${names}은(는) 최근 ${evidence.facts.days}일 동안 입지 않은 옷이에요.`;
    case "utilization":
      return `${names}은(는) ${evidence.facts.days}일 넘게 입지 않은 옷이라 이번에 꺼내 입기 좋아요.`;
  }
}

function list(clothes: Clothing[]) {
  return clothes.map((c) => c.name).join(", ");
}
