// The 옷장 분석 module: finds the 안 입는 옷 and why each goes unworn (원인),
// from the 옷장, the 착용 기록, the 추천 세션 and the user's own answers.
// Every rule is in this file, its numbers in one place.
import { daysBetween, koreaDate, todayInKorea } from "./dates";
import { candidateOutfits, colorHarmony, styleConsistency, type Basis } from "./scoring";
import type { Color, Clothing, Formality, Season, Style, Wardrobe } from "./wardrobe";
import type { WearRecord, WearRecords } from "./wear-records";
import type { RecommendationSessions } from "./recommendation-sessions";
import { ANSWERS, type Answer, type AnalysisStore } from "./analysis-store";

export type { Answer } from "./analysis-store";

// Not worn for this many days makes a piece 안 입는 옷.
const UNWORN_DAYS = 30;
// Registered fewer days ago than this, a piece is 신규 등록: not diagnosed.
const NEW_DAYS = 14;
// How far back the 일정 for 상황 불일치 are looked at.
const SITUATION_DAYS = 60;
// A look-alike worn this recently makes a 대체재 중복.
const SUBSTITUTE_DAYS = 30;
// A 코디 is well matched when both its color and style scores reach this.
const WELL_MATCHED = 0.7;
// Fewer well-matched 코디 than this is 조합 부족.
const ENOUGH_COMBINATIONS = 2;
// How far back what the user usually wears is looked at, and how many of the
// most worn colors and styles count.
const USUAL_DAYS = 90;
const USUAL_TOP = 3;
// How long 그대로 두기 keeps a piece out of the analysis.
const KEEP_DAYS = 90;

// The season each month is in, Korea's calendar.
const SEASON_OF_MONTH: Season[] = [
  "winter", "winter", "spring", "spring", "spring", "summer",
  "summer", "summer", "autumn", "autumn", "autumn", "winter",
];
const SEASON_ORDER: Season[] = ["spring", "summer", "autumn", "winter"];
const SEASON_START_MONTH: Record<Season, number> = { spring: 3, summer: 6, autumn: 9, winter: 12 };

// A 원인 found in the data, with the facts its sentence tells.
export type Cause =
  // Not for this season; good again from `fromMonth`.
  | { type: "season"; fromMonth: number }
  // Its 격식 수준 matched none of the recent 일정's.
  | { type: "situation"; formality: Formality; recentFormalities: Formality[] }
  // A look-alike was worn instead, last on `lastWornOn`.
  | { type: "substitute"; similar: { id: string; name: string }; lastWornOn: string }
  // Only `wellMatched` 코디 with it are well matched.
  | { type: "combination"; wellMatched: number }
  // Off both what the user likes and what they usually wear.
  | { type: "taste"; usualColors: Color[]; usualStyles: Style[] };

// What was made of one 안 입는 옷.
export type Verdict =
  | { kind: "new" }
  | { kind: "ask" }
  | { kind: "answered"; answer: Answer }
  | { kind: "cause"; cause: Cause };

// What the user is offered for it.
export type Remedy = "styling-outfits" | "season-reminder" | "care-tips" | "tidy-suggestion";

// 이번 주에 꺼내 볼 옷, and whether 다른 옷 보기 has anything else to show.
export type WeeklyPick = UnwornClothing & { hasOthers: boolean };

export type UnwornClothing = {
  clothing: Clothing;
  // The latest 착용 기록's date, or null if never worn.
  lastWornOn: string | null;
  verdict: Verdict;
  remedies: Remedy[];
  // Right for this season and not the last one: time to take it out again.
  backInSeason: boolean;
};

export function createWardrobeAnalysis({
  wardrobe,
  wearRecords,
  sessions,
  store,
  today = todayInKorea,
}: {
  wardrobe: Pick<Wardrobe, "clothes" | "registeredAt" | "preferences">;
  wearRecords: Pick<WearRecords, "wornBefore">;
  sessions: Pick<RecommendationSessions, "firstStepsBetween">;
  store: AnalysisStore;
  // YYYY-MM-DD in Korea.
  today?: () => string;
}) {
  const analysis = {
    // 분석하기: the user's 안 입는 옷, the longest unworn first.
    async analyze(userId: string): Promise<UnwornClothing[]> {
      const date = today();
      const [clothes, registeredAt, preferences, worn, firstSteps, answers, keptUntil] = await Promise.all([
        wardrobe.clothes(userId),
        wardrobe.registeredAt(userId),
        wardrobe.preferences(userId),
        wearRecords.wornBefore(userId, date),
        sessions.firstStepsBetween<{ basis: Basis | null }>(userId, shift(date, -SITUATION_DAYS), date),
        store.answers(userId),
        store.keptUntil(userId),
      ]);
      const lastWorn = lastWornOn(worn);
      const facts: Facts = {
        date,
        season: seasonOf(date),
        clothes,
        lastWorn,
        recentFormalities: unique(firstSteps.flatMap((step) => (step.basis ? [step.basis.formality] : []))),
        liked: { colors: preferences.colors, styles: preferences.styles },
        usual: usualLooks(worn, clothes, shift(date, -USUAL_DAYS)),
      };

      const unworn = clothes.flatMap((clothing) => {
        const lastWornOn = lastWorn.get(clothing.id) ?? null;
        if (!isUnworn(clothing, lastWornOn, date)) return [];
        const kept = keptUntil.get(clothing.id);
        if (kept && date < kept) return [];
        const registered = registeredAt.get(clothing.id);
        const age = registered ? daysBetween(koreaDate(registered), date) : Infinity;
        // An answer holds until the piece is worn on or after the day of it.
        const answered = answers.get(clothing.id);
        const answer = answered && (!lastWornOn || lastWornOn < answered.answeredOn) ? answered.answer : null;
        const verdict: Verdict = age < NEW_DAYS ? { kind: "new" } : diagnose(clothing, facts, answer);
        return [
          {
            clothing,
            lastWornOn,
            verdict,
            remedies: remediesFor(verdict),
            backInSeason: isBackInSeason(clothing, facts.season),
            registeredOn: registered,
          },
        ];
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
      return unworn.map(({ registeredOn, ...item }) => (void registeredOn, item));
    },

    // 이번 주에 꺼내 볼 옷: the same piece all week, while it stays a candidate.
    async weeklyPick(userId: string): Promise<WeeklyPick | null> {
      const candidates = await pickCandidates(userId);
      const week = weekStart(today());
      const saved = await store.weeklyPick(userId);
      const thisWeek = saved?.weekStart === week ? saved : null;
      const current = thisWeek && candidates.find((u) => u.clothing.id === thisWeek.clothingId);
      if (current) return { ...current, hasOthers: candidates.length > 1 };
      return choose(userId, candidates, week, thisWeek?.shown ?? []);
    },

    // 다른 옷 보기: the next candidate not shown this week, or the first again.
    async showAnotherPick(userId: string): Promise<WeeklyPick | null> {
      const candidates = await pickCandidates(userId);
      const week = weekStart(today());
      const saved = await store.weeklyPick(userId);
      return choose(userId, candidates, week, saved?.weekStart === week ? saved.shown : []);
    },

    // 답하기: why the user does not wear a piece the data said nothing about.
    async answer(userId: string, clothingId: string, answer: Answer) {
      if (!ANSWERS.includes(answer)) throw new Error("Unknown answer");
      await requireOwn(userId, clothingId);
      await store.saveAnswer(userId, clothingId, answer, today());
    },

    // 그대로 두기: out of the analysis for KEEP_DAYS.
    async keepAsIs(userId: string, clothingId: string) {
      await requireOwn(userId, clothingId);
      await store.keep(userId, clothingId, shift(today(), KEEP_DAYS));
    },
  };

  return analysis;

  // What can be the 이번 주에 꺼내 볼 옷: 안 입는 옷 not out of season, those
  // back in season first, then the longest unworn.
  async function pickCandidates(userId: string) {
    const unworn = await analysis.analyze(userId);
    const inSeason = unworn.filter((u) => !(u.verdict.kind === "cause" && u.verdict.cause.type === "season"));
    return [...inSeason.filter((u) => u.backInSeason), ...inSeason.filter((u) => !u.backInSeason)];
  }

  // The first candidate not in `shown`; after all were shown, the first again.
  async function choose(
    userId: string,
    candidates: UnwornClothing[],
    week: string,
    shown: string[],
  ): Promise<WeeklyPick | null> {
    if (candidates.length === 0) return null;
    const next = candidates.find((u) => !shown.includes(u.clothing.id));
    const picked = next ?? candidates[0];
    await store.saveWeeklyPick(userId, {
      weekStart: week,
      clothingId: picked.clothing.id,
      shown: next ? [...shown, picked.clothing.id] : [picked.clothing.id],
    });
    return { ...picked, hasOthers: candidates.length > 1 };
  }

  async function requireOwn(userId: string, clothingId: string) {
    if (!(await wardrobe.clothes(userId)).some((c) => c.id === clothingId)) {
      throw new Error("No such piece for this user");
    }
  }
}

export type WardrobeAnalysis = ReturnType<typeof createWardrobeAnalysis>;

// What every 원인 is judged from.
type Facts = {
  date: string;
  season: Season;
  clothes: Clothing[];
  lastWorn: Map<string, string>;
  recentFormalities: Formality[];
  liked: { colors: Color[]; styles: Style[] };
  usual: { colors: Color[]; styles: Style[] };
};

// The first 원인 that holds, in order of how sure it is; else what the user
// answered, or else they are asked.
function diagnose(clothing: Clothing, facts: Facts, answer: Answer | null): Verdict {
  const cause =
    seasonMismatch(clothing, facts) ??
    situationMismatch(clothing, facts) ??
    substitute(clothing, facts) ??
    lackingCombinations(clothing, facts) ??
    offTaste(clothing, facts);
  if (cause) return { kind: "cause", cause };
  return answer ? { kind: "answered", answer } : { kind: "ask" };
}

function seasonMismatch(clothing: Clothing, { season }: Facts): Cause | null {
  if (clothing.seasons.includes(season)) return null;
  const start = SEASON_ORDER.indexOf(season);
  for (let step = 1; step <= SEASON_ORDER.length; step++) {
    const next = SEASON_ORDER[(start + step) % SEASON_ORDER.length];
    if (clothing.seasons.includes(next)) return { type: "season", fromMonth: SEASON_START_MONTH[next] };
  }
  return null;
}

// Judged only when there were 일정 to compare with.
function situationMismatch(clothing: Clothing, { recentFormalities }: Facts): Cause | null {
  if (recentFormalities.length === 0 || recentFormalities.includes(clothing.formality)) return null;
  return { type: "situation", formality: clothing.formality, recentFormalities };
}

// A look-alike: same 종류, color and 격식 수준, still in the 옷장.
function substitute(clothing: Clothing, { clothes, lastWorn, date }: Facts): Cause | null {
  for (const other of clothes) {
    if (other.id === clothing.id) continue;
    if (other.slot !== clothing.slot || other.color !== clothing.color || other.formality !== clothing.formality) continue;
    const otherWorn = lastWorn.get(other.id);
    if (otherWorn && daysBetween(otherWorn, date) < SUBSTITUTE_DAYS) {
      return { type: "substitute", similar: { id: other.id, name: other.name }, lastWornOn: otherWorn };
    }
  }
  return null;
}

// Counted with the same color and style scores the 추천 uses, without the
// day's weather or 일정.
function lackingCombinations(clothing: Clothing, { clothes }: Facts): Cause | null {
  const withIt = candidateOutfits(clothes, clothing.slot === "outer").filter((outfit) =>
    Object.values(outfit).some((c) => c.id === clothing.id),
  );
  let wellMatched = 0;
  for (const outfit of withIt) {
    const items = Object.values(outfit);
    if (colorHarmony(items) >= WELL_MATCHED && styleConsistency(items) >= WELL_MATCHED) wellMatched++;
    if (wellMatched >= ENOUGH_COMBINATIONS) return null;
  }
  return { type: "combination", wellMatched };
}

// Judged only when there is a taste to compare with.
function offTaste(clothing: Clothing, { liked, usual }: Facts): Cause | null {
  const colors = [...liked.colors, ...usual.colors];
  const styles = [...liked.styles, ...usual.styles];
  if (colors.length === 0 && styles.length === 0) return null;
  if (colors.includes(clothing.color) || styles.includes(clothing.style)) return null;
  return { type: "taste", usualColors: usual.colors, usualStyles: usual.styles };
}

const ANSWER_REMEDIES: Record<Answer, Remedy[]> = {
  care: ["care-tips", "tidy-suggestion"],
  "changed-mind": ["tidy-suggestion"],
  forgot: ["styling-outfits"],
};

function remediesFor(verdict: Verdict): Remedy[] {
  if (verdict.kind === "new") return ["styling-outfits"];
  if (verdict.kind === "ask") return [];
  if (verdict.kind === "answered") return ANSWER_REMEDIES[verdict.answer];
  switch (verdict.cause.type) {
    case "season":
      return ["season-reminder"];
    case "substitute":
      return ["styling-outfits", "tidy-suggestion"];
    default:
      return ["styling-outfits"];
  }
}

function isBackInSeason(clothing: Clothing, season: Season) {
  const previous = SEASON_ORDER[(SEASON_ORDER.indexOf(season) + SEASON_ORDER.length - 1) % SEASON_ORDER.length];
  return clothing.seasons.includes(season) && !clothing.seasons.includes(previous);
}

// A piece is 안 입는 옷 when its latest wear is UNWORN_DAYS or more ago, or,
// never worn, unless the user said they wear it weekly or monthly.
function isUnworn(clothing: Clothing, lastWornOn: string | null, date: string) {
  if (lastWornOn) return daysBetween(lastWornOn, date) >= UNWORN_DAYS;
  return clothing.estimatedWearFrequency !== "weekly" && clothing.estimatedWearFrequency !== "monthly";
}

// Per clothing id, the date of its latest 착용 기록.
function lastWornOn(records: WearRecord[]) {
  const latest = new Map<string, string>();
  for (const record of records) {
    for (const id of record.clothingIds) {
      const seen = latest.get(id);
      if (!seen || record.date > seen) latest.set(id, record.date);
    }
  }
  return latest;
}

// The colors and styles worn most since `from`, USUAL_TOP of each.
function usualLooks(records: WearRecord[], clothes: Clothing[], from: string) {
  const byId = new Map(clothes.map((c) => [c.id, c]));
  const colors = new Map<Color, number>();
  const styles = new Map<Style, number>();
  for (const record of records) {
    if (record.date < from) continue;
    for (const id of record.clothingIds) {
      const clothing = byId.get(id);
      if (!clothing) continue;
      colors.set(clothing.color, (colors.get(clothing.color) ?? 0) + 1);
      styles.set(clothing.style, (styles.get(clothing.style) ?? 0) + 1);
    }
  }
  const top = <T>(counts: Map<T, number>) =>
    [...counts].sort((a, b) => b[1] - a[1]).slice(0, USUAL_TOP).map(([value]) => value);
  return { colors: top(colors), styles: top(styles) };
}

// The Monday of the week `date` is in (YYYY-MM-DD).
function weekStart(date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return shift(date, -((day + 6) % 7));
}

function seasonOf(date: string): Season {
  return SEASON_OF_MONTH[Number(date.slice(5, 7)) - 1];
}

// `date` moved by `days` (YYYY-MM-DD).
function shift(date: string, days: number) {
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}
