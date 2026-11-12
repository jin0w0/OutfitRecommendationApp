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
import { createTuningStore } from "./tuning-store";
import { createCloset, type Closet } from "./closet";
import { createNeonPhotoStorage } from "./neon-photo-storage";
import { createOpenAiClothingVision } from "./openai-vision";
import { createWardrobeAnalysis, type WardrobeAnalysis } from "./analysis";
import { createAnalysisStore } from "./analysis-store";
import { createPieceSuggestions, type PieceAdviser, type PieceSuggestions } from "./one-more-piece";
import { createPieceStore } from "./one-more-piece-store";
import { createOpenAiPieceAdviser } from "./openai-piece-adviser";

let instance: OutfitRecommender | undefined;
let closetInstance: Closet | undefined;
let analysisInstance: WardrobeAnalysis | undefined;
let piecesInstance: PieceSuggestions | undefined;

// The app's single 이 한 벌 제안 module, over the 옷장 in Neon and OpenAI.
export function getPieceSuggestions(): PieceSuggestions {
  if (!piecesInstance) {
    const dialect = new PostgresDialect({ pool: new Pool({ connectionString: requiredEnv("DATABASE_URL") }) });
    piecesInstance = createPieceSuggestions({
      wardrobe: createWardrobe({ dialect }),
      adviser: pieceAdviser(),
      store: createPieceStore({ dialect }),
    });
  }
  return piecesInstance;
}

// The app's single 옷장 분석 module, over the 옷장 and 착용 기록 in Neon.
export function getWardrobeAnalysis(): WardrobeAnalysis {
  if (!analysisInstance) {
    const dialect = new PostgresDialect({ pool: new Pool({ connectionString: requiredEnv("DATABASE_URL") }) });
    analysisInstance = createWardrobeAnalysis({
      wardrobe: createWardrobe({ dialect }),
      wearRecords: createWearRecords({ dialect }),
      sessions: createRecommendationSessions({ dialect }),
      store: createAnalysisStore({ dialect }),
      tuning: createTuningStore({ dialect }),
    });
  }
  return analysisInstance;
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

// The app's single 옷장 module, over the 옷장 in Neon, photos in Neon Object
// Storage and OpenAI to look at them. Built on first use, like the recommender.
export function getCloset(): Closet {
  closetInstance ??= createCloset({
    wardrobe: createWardrobe({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: requiredEnv("DATABASE_URL") }) }),
    }),
    photos: createNeonPhotoStorage({
      endpoint: requiredEnv("AWS_ENDPOINT_URL_S3"),
      region: requiredEnv("AWS_REGION"),
      accessKeyId: requiredEnv("AWS_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("AWS_SECRET_ACCESS_KEY"),
      bucket: requiredEnv("CLOTHING_PHOTO_BUCKET"),
    }),
    vision: clothingVision(),
  });
  return closetInstance;
}

// Without a key every analysis fails, so 옷 등록 goes on with an empty draft
// for the user to fill.
function clothingVision() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) return createOpenAiClothingVision({ apiKey, model: process.env.OPENAI_MODEL || undefined });
  return {
    async look(): Promise<never> {
      throw new Error("Missing environment variable OPENAI_API_KEY");
    },
  };
}

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
      tuning: createTuningStore({ dialect }),
      pieceAdviser: pieceAdviser(),
      pieceStore: createPieceStore({ dialect }),
    });
  }
  return instance;
}

// Without a key every request fails, so nothing is suggested and 구매 추천
// says it cannot be made.
function pieceAdviser(): PieceAdviser {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) return createOpenAiPieceAdviser({ apiKey, model: process.env.OPENAI_MODEL || undefined });
  const missingKey = async (): Promise<never> => {
    throw new Error("Missing environment variable OPENAI_API_KEY");
  };
  return { proposePieces: missingKey, proposeOutfits: missingKey };
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
