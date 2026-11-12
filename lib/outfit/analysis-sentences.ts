// What the 옷장 분석 says about each 안 입는 옷: template sentences from the
// verdict's facts alone.
import type { UnwornClothing } from "./analysis";
import { COLOR_NAMES, FORMALITY_NAMES, SEASON_NAMES, STYLE_NAMES } from "./clothing-names";

export function verdictSentence({ clothing, verdict, backInSeason }: UnwornClothing): string {
  const back = backInSeason ? "이제 꺼내 입을 때예요. " : "";
  switch (verdict.kind) {
    case "new":
      return `${back}새로 들어온 옷이에요. 이렇게 입어 보세요.`;
    case "ask":
      return `${back}왜 잘 안 입으세요?`;
    case "cause": {
      const cause = verdict.cause;
      switch (cause.type) {
        case "season":
          return `${clothing.seasons.map((s) => SEASON_NAMES[s]).join("·")}에 입는 옷이라 지금은 철이 아니에요. ${cause.fromMonth}월쯤부터 입기 좋아요.`;
        case "situation":
          return `${back}${FORMALITY_NAMES[cause.formality]} 옷인데, 최근 일정은 ${cause.recentFormalities
            .map((f) => FORMALITY_NAMES[f])
            .join(", ")} 자리였어요. 그런 자리가 생기면 꺼내 보세요.`;
        case "substitute":
          return `${back}비슷한 ${cause.similar.name}을(를) ${monthDay(cause.lastWornOn)}에 입으셨어요. 그 옷과 번갈아 입거나 정리해 보세요.`;
        case "combination":
          return cause.wellMatched === 0
            ? `${back}지금 옷장에는 함께 입기 잘 어울리는 옷이 없어요.`
            : `${back}잘 어울리는 조합이 ${cause.wellMatched}개뿐이에요.`;
        case "taste": {
          const usual = [...cause.usualColors.map((c) => COLOR_NAMES[c]), ...cause.usualStyles.map((s) => STYLE_NAMES[s])];
          return usual.length
            ? `${back}평소 ${usual.join(", ")} 옷을 주로 입으셔서 손이 덜 가는 옷이에요.`
            : `${back}평소 좋아하시는 색이나 스타일과 달라서 손이 덜 가는 옷이에요.`;
        }
      }
    }
  }
}

function monthDay(date: string) {
  return `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`;
}
