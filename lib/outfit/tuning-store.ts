// What 추천 맞춤 is worked out from: each 거절 with its 거절 이유, and the
// user's 추천 맞춤 settings. No app imports, so scripts load it with plain Node.
import { Kysely, sql, type Dialect, type Generated, type JSONColumnType } from "kysely";

export const REJECTION_REASONS = ["color", "taste", "weather", "event", "dislike", "other"] as const;
// 거절 이유: 색 조합, 스타일 취향, 날씨, 일정, 입기 싫은 옷, 그냥 다른 것.
export type RejectionReason = (typeof REJECTION_REASONS)[number];

type Tables = {
  rejection: {
    id: Generated<number>;
    user_id: string;
    date: string;
    reason: RejectionReason | null;
    disliked_clothing_id: string | null;
    created_at: Generated<Date>;
  };
  tuning_setting: { user_id: string; reset_at: Date | null; tilt_off: Generated<boolean> };
  // One per date: the factors of the 추천 이유 of the 코디 accepted for it.
  acceptance_tuning: { user_id: string; date: string; factors: JSONColumnType<string[]>; created_at: Date };
};

export function createTuningStore({ dialect }: { dialect: Dialect }) {
  const db = new Kysely<Tables>({ dialect });

  return {
    async migrate() {
      await db.schema
        .createTable("rejection")
        .ifNotExists()
        .addColumn("id", "serial", (c) => c.primaryKey())
        .addColumn("user_id", "text", (c) => c.notNull().references("user.id").onDelete("cascade"))
        .addColumn("date", "text", (c) => c.notNull())
        .addColumn("reason", "text")
        .addColumn("disliked_clothing_id", "text", (c) => c.references("clothing.id").onDelete("cascade"))
        .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
        .execute();
      await db.schema
        .createTable("tuning_setting")
        .ifNotExists()
        .addColumn("user_id", "text", (c) => c.primaryKey().references("user.id").onDelete("cascade"))
        .addColumn("reset_at", "timestamptz")
        .addColumn("tilt_off", "boolean", (c) => c.notNull().defaultTo(false))
        .execute();
      await db.schema
        .createTable("acceptance_tuning")
        .ifNotExists()
        .addColumn("user_id", "text", (c) => c.notNull().references("user.id").onDelete("cascade"))
        .addColumn("date", "text", (c) => c.notNull())
        .addColumn("factors", "jsonb", (c) => c.notNull())
        .addColumn("created_at", "timestamptz", (c) => c.notNull())
        .addPrimaryKeyConstraint("acceptance_tuning_pkey", ["user_id", "date"])
        .execute();
    },

    // Replaces the date's earlier acceptance, if any.
    async saveAcceptance(userId: string, date: string, factors: string[]) {
      const values = { factors: JSON.stringify(factors), created_at: new Date() };
      await db
        .insertInto("acceptance_tuning")
        .values({ user_id: userId, date, ...values })
        .onConflict((oc) => oc.columns(["user_id", "date"]).doUpdateSet(values))
        .execute();
    },

    async removeAcceptance(userId: string, date: string) {
      await db.deleteFrom("acceptance_tuning").where("user_id", "=", userId).where("date", "=", date).execute();
    },

    // The acceptances made since the user last went back to the start.
    async acceptancesSinceReset(userId: string) {
      const resetAt = await this.resetAt(userId);
      let query = db.selectFrom("acceptance_tuning").select(["date", "factors"]).where("user_id", "=", userId);
      if (resetAt) query = query.where("created_at", ">", resetAt);
      return query.execute();
    },

    async saveRejection(
      userId: string,
      { date, reason, dislikedClothingId }: { date: string; reason: RejectionReason | null; dislikedClothingId: string | null },
    ) {
      await db
        .insertInto("rejection")
        .values({ user_id: userId, date, reason, disliked_clothing_id: dislikedClothingId })
        .execute();
    },

    // The 거절 made since the user last went back to the start.
    async rejectionsSinceReset(userId: string) {
      const resetAt = await this.resetAt(userId);
      let query = db.selectFrom("rejection").select(["date", "reason", "disliked_clothing_id"]).where("user_id", "=", userId);
      if (resetAt) query = query.where("created_at", ">", resetAt);
      return query.execute();
    },

    async resetAt(userId: string): Promise<Date | null> {
      const row = await db.selectFrom("tuning_setting").select("reset_at").where("user_id", "=", userId).executeTakeFirst();
      return row?.reset_at ?? null;
    },

    async reset(userId: string) {
      // A moment later than every record so far, whatever the clock's grain.
      const latest = await sql<{ latest: Date | null }>`
        select greatest(
          (select max(created_at) from rejection where user_id = ${userId}),
          (select max(created_at) from acceptance_tuning where user_id = ${userId})
        ) as latest`.execute(db);
      const last = latest.rows[0]?.latest ? new Date(latest.rows[0].latest) : null;
      const now = new Date();
      const resetAt = last && last >= now ? new Date(last.getTime() + 1) : now;
      await db
        .insertInto("tuning_setting")
        .values({ user_id: userId, reset_at: resetAt })
        .onConflict((oc) => oc.column("user_id").doUpdateSet({ reset_at: resetAt }))
        .execute();
    },
  };
}

export type TuningStore = ReturnType<typeof createTuningStore>;
