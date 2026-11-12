// What the 옷장 분석 says about each 안 입는 옷: template sentences from the
// verdict's facts alone.
import type { UnwornClothing } from "./analysis";
import { COLOR_NAMES, FORMALITY_NAMES, SEASON_NAMES, STYLE_NAMES } from "./clothing-names";
import type { Material } from "./wardrobe";

export function verdictSentence({ clothing, verdict, backInSeason }: UnwornClothing): string {
  const back = backInSeason ? "이제 꺼내 입을 때예요. " : "";
  switch (verdict.kind) {
    case "new":
      return `${back}새로 들어온 옷이에요. 이렇게 입어 보세요.`;
    case "ask":
      return `${back}왜 잘 안 입으세요?`;
    case "answered":
      return {
        care: `${back}관리가 번거로워서 손이 덜 가는 옷이에요.`,
        "changed-mind": `${back}더 이상 마음에 들지 않는 옷이에요.`,
        forgot: `${back}잊고 있던 옷이에요. 이렇게 입어 보세요.`,
      }[verdict.answer];
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

// 관리 팁 for a piece the user finds a bother to look after, by 소재.
export const CARE_TIPS: Record<Material, string> = {
  cotton: "찬물에 뒤집어 빨면 색이 덜 빠지고, 탈수를 짧게 하면 다림질이 거의 필요 없어요.",
  linen: "젖었을 때 털어서 옷걸이에 널면 구김이 덜 가요. 살짝 구겨진 대로 입어도 린넨답게 멋스러워요.",
  denim: "자주 빨지 않아도 돼요. 입은 뒤 바람이 통하는 곳에 걸어 두고, 빨 때는 뒤집어 찬물에 빨아요.",
  wool: "세탁망에 넣어 울 코스로 빨고 눕혀 말리면 늘어나지 않아요. 입은 뒤 솔질만 해도 오래 입어요.",
  knit: "세탁망에 넣어 울 코스로 빨고 눕혀 말리면 늘어나지 않아요. 보풀은 보풀 제거기로 금방 정리돼요.",
  leather: "물기에 약하니 젖으면 마른 천으로 닦고 그늘에 말려요. 가끔 가죽 크림을 얇게 발라 주면 충분해요.",
  suede: "스웨이드 솔로 결 방향대로 쓸어 주면 돼요. 비 오는 날만 피하면 관리가 어렵지 않아요.",
  canvas: "중성세제를 묻힌 솔로 부분 세척하고 그늘에 말려요. 통째로 빨 필요는 거의 없어요.",
  synthetic: "구김과 줄어듦이 적어 손빨래나 일반 코스로 빨아도 괜찮아요. 건조기만 피하면 돼요.",
};

function monthDay(date: string) {
  return `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`;
}
