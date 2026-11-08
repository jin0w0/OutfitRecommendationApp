import "server-only";
import { PostgresDialect } from "kysely";
import { Pool } from "pg";
import { getAccount } from "@/lib/account/server";
import { createGoogleCalendarEvents } from "./google-calendar-events";
import { createEventCorrections } from "./event-corrections";
import { createKmaWeather } from "./kma-weather";
import { createOpenAiLanguageModel } from "./openai-llm";
import {
  createOutfitRecommender,
  type LanguageModel,
  type OutfitRecommender,
  type WeatherSource,
} from "./recommender";
import { createWardrobe } from "./wardrobe";
import { createWearRecords } from "./wear-records";
import { createRecommendationSessions } from "./recommendation-sessions";

let instance: OutfitRecommender | undefined;

// The app's single 코디 추천 module, over the 옷장, 착용 기록, 일정 판단 수정값 and 추천 세션 in Neon, the
// 기상청 단기예보, the user's Google Calendar and OpenAI. Built on first use so that
// `next build` does not need the secrets.
export function getOutfitRecommender(): OutfitRecommender {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Missing environment variable DATABASE_URL");
  if (!instance) {
    const dialect = new PostgresDialect({ pool: new Pool({ connectionString }) });
    instance = createOutfitRecommender({
      wardrobe: createWardrobe({ dialect }),
      weather: weatherSource(),
      calendar: createGoogleCalendarEvents(getAccount()),
      llm: languageModel(),
      wearRecords: createWearRecords({ dialect }),
      eventCorrections: createEventCorrections({ dialect }),
      sessions: createRecommendationSessions({ dialect }),
    });
  }
  return instance;
}

// Without a key every forecast fails, so recommendations go on without weather
// and say so, rather than the page breaking.
function weatherSource(): WeatherSource {
  const authKey = process.env.KMA_AUTH_KEY;
  if (authKey) return createKmaWeather({ authKey });
  return {
    async forecast() {
      throw new Error("Missing environment variable KMA_AUTH_KEY");
    },
  };
}

// Without a key every LLM call fails, so recommendations go on without the
// 일정 judged and with template 추천 이유, 대화로 수정하기 leaves the 코디 as
// it was, and each says so.
function languageModel(): LanguageModel {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) return createOpenAiLanguageModel({ apiKey, model: process.env.OPENAI_MODEL || undefined });
  const missingKey = async (): Promise<never> => {
    throw new Error("Missing environment variable OPENAI_API_KEY");
  };
  return { judgeEvents: missingKey, writeReasons: missingKey, interpretRevision: missingKey };
}
