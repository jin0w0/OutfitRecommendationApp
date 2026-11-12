import type { Factor } from "@/lib/outfit/recommender";
import { getOutfitRecommender } from "@/lib/outfit/server";
import { resetTuning } from "../actions";

// What each factor is called when telling the user it is minded more.
const FACTOR_NAMES: Record<Factor, string> = {
  weather: "날씨",
  event: "일정과의 어울림",
  color: "색 조합",
  style: "스타일 통일감",
  preference: "내 취향",
  recency: "최근에 안 입은 옷",
  utilization: "오래 안 입은 옷",
};

// 내 추천 맞춤: what the 추천 now minds more for this user, and the way back.
export async function TuningSection({ userId }: { userId: string }) {
  const { multipliers } = await getOutfitRecommender().tuning(userId);
  const minded = (Object.entries(multipliers) as [Factor, number][])
    .filter(([, multiplier]) => multiplier > 1)
    .sort((a, b) => b[1] - a[1]);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">내 추천 맞춤</h2>
      {minded.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          아직 처음 기준 그대로 추천하고 있어요. 다시 추천받을 때 이유를 고르거나 &quot;입을게요&quot;를 누르면 점점
          맞춰져요.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {minded.map(([factor, multiplier]) => (
            <li key={factor}>
              {FACTOR_NAMES[factor]}을(를) 더 신경 써요{" "}
              <span className="text-zinc-500">(처음의 {multiplier.toFixed(2)}배)</span>
            </li>
          ))}
        </ul>
      )}
      <form action={resetTuning}>
        <button type="submit" className="text-sm text-zinc-600 underline dark:text-zinc-400">
          처음 상태로 되돌리기
        </button>
      </form>
    </section>
  );
}
