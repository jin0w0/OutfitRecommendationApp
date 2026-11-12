// What the 옷장 분석 keeps of its own: the user's answers about 안 입는 옷 and
// the pieces they asked to 그대로 두기. Removed with the user or the piece.
import { Kysely, type Dialect, type JSONColumnType } from "kysely";

export const ANSWERS = ["care", "changed-mind", "forgot"] as const;
// Why the user says they do not wear a piece: 관리 번거로움, 마음 변화, or
// they had just forgotten it.
export type Answer = (typeof ANSWERS)[number];

type Tables = {
  clothing_answer: { user_id: string; clothing_id: string; answer: Answer; answered_on: string };
  clothing_kept: { user_id: string; clothing_id: string; until: string };
  weekly_pick: { user_id: string; week_start: string; clothing_id: string; shown: JSONColumnType<string[]> };
};

// The 이번 주에 꺼내 볼 옷 as last chosen: for which week, which piece, and
// every piece shown that week.
export type WeeklyPick = { weekStart: string; clothingId: string; shown: string[] };

export function createAnalysisStore({ dialect }: { dialect: Dialect }) {
  const db = new Kysely<Tables>({ dialect });

  return {
    async migrate() {
      await db.schema
        .createTable("clothing_answer")
        .ifNotExists()
        .addColumn("user_id", "text", (c) => c.notNull().references("user.id").onDelete("cascade"))
        .addColumn("clothing_id", "text", (c) => c.notNull().references("clothing.id").onDelete("cascade"))
        .addColumn("answer", "text", (c) => c.notNull())
        .addColumn("answered_on", "text", (c) => c.notNull())
        .addPrimaryKeyConstraint("clothing_answer_pkey", ["user_id", "clothing_id"])
        .execute();
      await db.schema
        .createTable("clothing_kept")
        .ifNotExists()
        .addColumn("user_id", "text", (c) => c.notNull().references("user.id").onDelete("cascade"))
        .addColumn("clothing_id", "text", (c) => c.notNull().references("clothing.id").onDelete("cascade"))
        .addColumn("until", "text", (c) => c.notNull())
        .addPrimaryKeyConstraint("clothing_kept_pkey", ["user_id", "clothing_id"])
        .execute();
      await db.schema
        .createTable("weekly_pick")
        .ifNotExists()
        .addColumn("user_id", "text", (c) => c.primaryKey().references("user.id").onDelete("cascade"))
        .addColumn("week_start", "text", (c) => c.notNull())
        .addColumn("clothing_id", "text", (c) => c.notNull())
        .addColumn("shown", "jsonb", (c) => c.notNull())
        .execute();
    },

    async weeklyPick(userId: string): Promise<WeeklyPick | null> {
      const row = await db.selectFrom("weekly_pick").selectAll().where("user_id", "=", userId).executeTakeFirst();
      return row ? { weekStart: row.week_start, clothingId: row.clothing_id, shown: row.shown } : null;
    },

    async saveWeeklyPick(userId: string, { weekStart, clothingId, shown }: WeeklyPick) {
      const values = { week_start: weekStart, clothing_id: clothingId, shown: JSON.stringify(shown) };
      await db
        .insertInto("weekly_pick")
        .values({ user_id: userId, ...values })
        .onConflict((oc) => oc.column("user_id").doUpdateSet(values))
        .execute();
    },

    // Answering again replaces the earlier answer.
    async saveAnswer(userId: string, clothingId: string, answer: Answer, answeredOn: string) {
      await db
        .insertInto("clothing_answer")
        .values({ user_id: userId, clothing_id: clothingId, answer, answered_on: answeredOn })
        .onConflict((oc) => oc.columns(["user_id", "clothing_id"]).doUpdateSet({ answer, answered_on: answeredOn }))
        .execute();
    },

    async answers(userId: string): Promise<Map<string, { answer: Answer; answeredOn: string }>> {
      const rows = await db.selectFrom("clothing_answer").selectAll().where("user_id", "=", userId).execute();
      return new Map(rows.map((r) => [r.clothing_id, { answer: r.answer, answeredOn: r.answered_on }]));
    },

    // 그대로 두기 until `until` (YYYY-MM-DD), the day it is looked at again.
    async keep(userId: string, clothingId: string, until: string) {
      await db
        .insertInto("clothing_kept")
        .values({ user_id: userId, clothing_id: clothingId, until })
        .onConflict((oc) => oc.columns(["user_id", "clothing_id"]).doUpdateSet({ until }))
        .execute();
    },

    async keptUntil(userId: string): Promise<Map<string, string>> {
      const rows = await db.selectFrom("clothing_kept").selectAll().where("user_id", "=", userId).execute();
      return new Map(rows.map((r) => [r.clothing_id, r.until]));
    },
  };
}

export type AnalysisStore = ReturnType<typeof createAnalysisStore>;
