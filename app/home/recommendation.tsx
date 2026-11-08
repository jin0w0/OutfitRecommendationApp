import type { Outfit, Recommendation } from "@/lib/outfit/recommender";
import { acceptOutfit, cancelAcceptance } from "./actions";
import { EVENT_KINDS, FORMALITY_NAMES, type EventKind } from "@/lib/outfit/situations";
import type { Slot } from "@/lib/outfit/wardrobe";

const SLOT_NAMES: Record<Slot, string> = {
  top: "상의",
  bottom: "하의",
  dress: "원피스",
  outer: "아우터",
  shoes: "신발",
};

const SLOT_ORDER: (keyof Outfit)[] = ["outer", "top", "bottom", "dress", "shoes"];

// Plain GET form, so the chosen date and 일정 live in the URL.
export function OutfitRequestForm({
  date,
  situation,
}: {
  date: string;
  situation: EventKind | null;
}) {
  return (
    <form action="/home" className="flex flex-wrap items-center gap-3">
      <input
        type="date"
        name="date"
        defaultValue={date}
        aria-label="날짜"
        className="h-10 rounded-md border border-zinc-300 bg-transparent px-3 dark:border-zinc-700"
      />
      <select
        name="situation"
        defaultValue={situation ?? ""}
        aria-label="일정"
        className="h-10 rounded-md border border-zinc-300 bg-transparent px-3 dark:border-zinc-700"
      >
        <option value="">일정 없음</option>
        {Object.entries(EVENT_KINDS).map(([kind, { name }]) => (
          <option key={kind} value={kind}>
            {name}
          </option>
        ))}
      </select>
      <button type="submit" className="h-10 rounded-full bg-foreground px-5 text-background">
        추천받기
      </button>
    </form>
  );
}

export function RecommendationView({
  recommendation,
  regionName,
  situation,
  shown,
}: {
  recommendation: Recommendation;
  // The 기본 지역 the weather is for.
  regionName: string;
  situation: EventKind | null;
  // 코디 already shown for this date, as clothing ids.
  shown: string[][];
}) {
  const { basis, date, accepted } = recommendation;
  const hidden = (
    <>
      <input type="hidden" name="date" value={date} />
      {situation && <input type="hidden" name="situation" value={situation} />}
    </>
  );
  return (
    <section className="flex flex-col gap-4">
      {accepted && (
        <div className="flex flex-col gap-3 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 dark:border-emerald-800 dark:bg-emerald-950">
          <p className="text-sm font-medium">
            {accepted.status === "worn" ? "이 날 입은 코디로 기록했어요" : "이 날 입을 계획으로 저장했어요"}
          </p>
          <p className="text-sm">{accepted.clothes.map((c) => c.name).join(", ")}</p>
          <form action={cancelAcceptance}>
            {hidden}
            <button type="submit" className="text-sm text-zinc-600 underline dark:text-zinc-400">
              수락 취소
            </button>
          </form>
        </div>
      )}
      <h2 className="font-medium">
        {date} 코디
        {basis && (
          <span className="ml-2 text-sm font-normal text-zinc-600 dark:text-zinc-400">
            {EVENT_KINDS[basis.kind].name} · {FORMALITY_NAMES[basis.formality]} 기준
          </span>
        )}
      </h2>
      <WeatherLine recommendation={recommendation} regionName={regionName} />
      {recommendation.status === "ok" ? (
        <>
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {SLOT_ORDER.flatMap((slot) => {
              const clothing = recommendation.outfit[slot];
              if (!clothing) return [];
              return (
                <li key={slot} className="flex items-center gap-3 px-4 py-3">
                  <span className="w-14 text-sm text-zinc-500">{SLOT_NAMES[slot]}</span>
                  <span className="flex-1">{clothing.name}</span>
                  <span className="text-xs text-zinc-500">{FORMALITY_NAMES[clothing.formality]}</span>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap gap-3">
            <form action={acceptOutfit}>
              {hidden}
              {Object.values(recommendation.outfit).map((clothing) => (
                <input key={clothing.id} type="hidden" name="clothing" value={clothing.id} />
              ))}
              <button type="submit" className="h-10 rounded-full bg-foreground px-5 text-background">
                입을게요
              </button>
            </form>
            {/* Plain GET form: the 코디 shown so far live in the URL. */}
            <form action="/home">
              {hidden}
              {[
                ...new Set(
                  [...shown, Object.values(recommendation.outfit).map((c) => c.id)].map((ids) =>
                    ids.join("."),
                  ),
                ),
              ].map((value) => (
                <input key={value} type="hidden" name="shown" value={value} />
              ))}
              <button
                type="submit"
                className="h-10 rounded-full border border-zinc-300 px-5 dark:border-zinc-700"
              >
                다시 추천받기
              </button>
            </form>
          </div>
        </>
      ) : (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          옷장에 {recommendation.missingSlots.map((slot) => SLOT_NAMES[slot]).join(", ")}이(가)
          부족해서 {basis ? "이 일정에 맞는 " : ""}코디를 만들 수 없어요.
        </p>
      )}
    </section>
  );
}

// The weather the 코디 was chosen for, or why it was not 반영.
function WeatherLine({
  recommendation: { weather, missing },
  regionName,
}: {
  recommendation: Recommendation;
  regionName: string;
}) {
  if (weather) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {regionName} 날씨 {weather.temperature}°C · {weather.rain ? "비 소식 있음" : "비 소식 없음"}
      </p>
    );
  }
  return (
    <p className="rounded-lg border border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
      {missing.includes("weather-failed")
        ? "날씨 정보를 불러오지 못해 날씨는 반영하지 않았어요."
        : "이 날짜는 아직 예보가 없어 날씨는 반영하지 않았어요."}
    </p>
  );
}
