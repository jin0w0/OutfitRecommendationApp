// The 옷장 분석 module: finds the 안 입는 옷 and why each goes unworn (원인),
// from the 옷장, the 착용 기록 and the user's own answers. Every rule is in
// this file, its numbers in one place; the sentences are templates.
import { daysBetween, koreaDate, todayInKorea } from "./dates";
import type { Clothing, Wardrobe } from "./wardrobe";
import type { WearRecords } from "./wear-records";

// Not worn for this many days makes a piece 안 입는 옷.
const UNWORN_DAYS = 30;
// Registered fewer days ago than this, a piece is 신규 등록: not diagnosed.
const NEW_DAYS = 14;

// What was made of one 안 입는 옷.
export type Verdict = { kind: "new" } | { kind: "ask" };

export type UnwornClothing = {
  clothing: Clothing;
  // The latest 착용 기록's date, or null if never worn.
  lastWornOn: string | null;
  verdict: Verdict;
};

export function createWardrobeAnalysis({
  wardrobe,
  wearRecords,
  today = todayInKorea,
}: {
  wardrobe: Pick<Wardrobe, "clothes" | "registeredAt">;
  wearRecords: Pick<WearRecords, "wornBefore">;
  // YYYY-MM-DD in Korea.
  today?: () => string;
}) {
  return {
    // 분석하기: the user's 안 입는 옷, the longest unworn first.
    async analyze(userId: string): Promise<UnwornClothing[]> {
      const date = today();
      const [clothes, registeredAt, lastWorn] = await Promise.all([
        wardrobe.clothes(userId),
        wardrobe.registeredAt(userId),
        lastWornOn(userId, date),
      ]);

      const unworn = clothes.flatMap((clothing) => {
        const worn = lastWorn.get(clothing.id) ?? null;
        if (!isUnworn(clothing, worn, date)) return [];
        const registered = registeredAt.get(clothing.id);
        const age = registered ? daysBetween(koreaDate(registered), date) : Infinity;
        const verdict: Verdict = age < NEW_DAYS ? { kind: "new" } : { kind: "ask" };
        return [{ clothing, lastWornOn: worn, verdict, registeredOn: registered }];
      });

      // Never worn first (the longest registered first), then the oldest wear.
      unworn.sort((a, b) => {
        if (a.lastWornOn === null && b.lastWornOn === null) {
          return (a.registeredOn?.getTime() ?? 0) - (b.registeredOn?.getTime() ?? 0);
        }
        if (a.lastWornOn === null) return -1;
        if (b.lastWornOn === null) return 1;
        return a.lastWornOn.localeCompare(b.lastWornOn);
      });
      return unworn.map(({ clothing, lastWornOn, verdict }) => ({ clothing, lastWornOn, verdict }));
    },
  };

  // Per clothing id, the date of its latest 착용 기록 before `date`.
  async function lastWornOn(userId: string, date: string) {
    const latest = new Map<string, string>();
    for (const record of await wearRecords.wornBefore(userId, date)) {
      for (const id of record.clothingIds) {
        const seen = latest.get(id);
        if (!seen || record.date > seen) latest.set(id, record.date);
      }
    }
    return latest;
  }
}

// A piece is 안 입는 옷 when its latest wear is UNWORN_DAYS or more ago, or,
// never worn, unless the user said they wear it weekly or monthly.
function isUnworn(clothing: Clothing, lastWornOn: string | null, date: string) {
  if (lastWornOn) return daysBetween(lastWornOn, date) >= UNWORN_DAYS;
  return clothing.estimatedWearFrequency !== "weekly" && clothing.estimatedWearFrequency !== "monthly";
}

export type WardrobeAnalysis = ReturnType<typeof createWardrobeAnalysis>;
