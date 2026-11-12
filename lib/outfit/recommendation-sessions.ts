// 추천 세션: one 날짜로 추천받기 and the 대화로 수정하기 that followed it, kept
// per user in Postgres so a 수정 can build on the last one. Each step is the
// 추천 결과 as it was returned, with the 수정 조건 accumulated up to it. A new
// 날짜로 추천받기 replaces the user's earlier session for that date; 탈퇴 removes
// them all.
// A 구매 추천 세션 is kept the same way, as another kind, so neither replaces
// the other.
import { randomUUID } from "node:crypto";
import { Kysely, sql, type Dialect, type Generated, type JSONColumnType } from "kysely";

//   outfit: 날짜로 추천받기 and 대화로 수정하기 (추천 세션)
//   purchase: 구매 추천 and 구매 대화 (구매 추천 세션)
export type SessionKind = "outfit" | "purchase";

export type RecommendationSession<Step> = {
  id: string;
  date: string;
  // The 추천 결과 at each step, oldest first: the first is 날짜로 추천받기's,
  // each later one a 대화로 수정하기.
  steps: Step[];
};

type Tables = {
  recommendation_session: {
    id: string;
    user_id: string;
    // YYYY-MM-DD
    date: string;
    steps: JSONColumnType<unknown[]>;
    kind: Generated<SessionKind>;
    updated_at: Generated<Date>;
  };
};

export function createRecommendationSessions({ dialect }: { dialect: Dialect }) {
  const db = new Kysely<Tables>({ dialect });

  return {
    async migrate() {
      await db.schema
        .createTable("recommendation_session")
        .ifNotExists()
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("user_id", "text", (c) =>
          c.notNull().references("user.id").onDelete("cascade"),
        )
        .addColumn("date", "text", (c) => c.notNull())
        .addColumn("steps", "jsonb", (c) => c.notNull())
        .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
        .execute();
      await sql`alter table recommendation_session add column if not exists kind text not null default 'outfit'`.execute(db);
      await db.schema
        .createIndex("recommendation_session_user_date")
        .ifNotExists()
        .on("recommendation_session")
        .columns(["user_id", "date"])
        .execute();
    },

    // Starts a session of `kind` for the user and date with its first step,
    // replacing any earlier one of that kind for that date. Resolves to the
    // new session's id.
    async start<Step>(userId: string, date: string, first: Step, kind: SessionKind = "outfit") {
      const id = randomUUID();
      await db.transaction().execute(async (trx) => {
        await trx
          .deleteFrom("recommendation_session")
          .where("user_id", "=", userId)
          .where("date", "=", date)
          .where("kind", "=", kind)
          .execute();
        // Nothing is kept for a user who no longer exists (after 탈퇴).
        await sql`
          insert into recommendation_session (id, user_id, date, steps, kind)
          select ${id}, ${userId}, ${date}, ${JSON.stringify([first])}::jsonb, ${kind}
          where exists (select 1 from "user" where id = ${userId})
        `.execute(trx);
      });
      return id;
    },

    // The user's session `id` of `kind`, or undefined when it is not theirs,
    // is of another kind or has been replaced.
    async get<Step>(
      userId: string,
      id: string,
      kind: SessionKind = "outfit",
    ): Promise<RecommendationSession<Step> | undefined> {
      const row = await db
        .selectFrom("recommendation_session")
        .select(["id", "date", "steps"])
        .where("user_id", "=", userId)
        .where("id", "=", id)
        .where("kind", "=", kind)
        .executeTakeFirst();
      return row && { id: row.id, date: row.date, steps: row.steps as Step[] };
    },

    // The first step of each of the user's 추천 세션 for dates from `from` up
    // to and including `to` (YYYY-MM-DD): what each day was first asked for.
    async firstStepsBetween<Step>(userId: string, from: string, to: string): Promise<Step[]> {
      const rows = await db
        .selectFrom("recommendation_session")
        .select("steps")
        .where("user_id", "=", userId)
        .where("date", ">=", from)
        .where("date", "<=", to)
        .where("kind", "=", "outfit")
        .execute();
      return rows.flatMap((row) => (row.steps.length ? [row.steps[0] as Step] : []));
    },

    // Replaces the session's steps.
    async saveSteps<Step>(userId: string, id: string, steps: Step[]) {
      await db
        .updateTable("recommendation_session")
        .set({ steps: JSON.stringify(steps), updated_at: sql`now()` })
        .where("user_id", "=", userId)
        .where("id", "=", id)
        .execute();
    },
  };
}

export type RecommendationSessions = ReturnType<typeof createRecommendationSessions>;
