import "server-only";
import { PostgresDialect } from "kysely";
import { Pool } from "pg";
import { getAccount } from "@/lib/account/server";
import { createGoogleCalendarEvents } from "./google-calendar-events";
import { createKmaWeather } from "./kma-weather";
import { createOutfitRecommender, type OutfitRecommender, type WeatherSource } from "./recommender";
import { createWardrobe } from "./wardrobe";

let instance: OutfitRecommender | undefined;

// The app's single 코디 추천 module, over the 옷장 in Neon, the 기상청
// 단기예보 and the user's Google Calendar. Built on first use so that `next build` does not need the secrets.
export function getOutfitRecommender(): OutfitRecommender {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Missing environment variable DATABASE_URL");
  instance ??= createOutfitRecommender({
    wardrobe: createWardrobe({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString }) }),
    }),
    weather: weatherSource(),
    calendar: createGoogleCalendarEvents(getAccount()),
  });
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
