import { createTestAccount } from "@/lib/account/testing/harness";
import { createOutfitRecommender, type Weather, type WeatherSource } from "../recommender";
import { createWardrobe, type NewClothing } from "../wardrobe";
import { createWearRecords } from "../wear-records";

// A recommender over a real 옷장 and 착용 기록 in an in-process Postgres, next
// to the account tables so clothes belong to real users. `today` is the date
// the recommender takes as today (YYYY-MM-DD).
export async function createTestOutfit({ today = "2026-11-10" }: { today?: string } = {}) {
  const { account, google, dialect, signInWithGoogle } = await createTestAccount();
  await account.migrate();
  const wardrobe = createWardrobe({ dialect });
  await wardrobe.migrate();
  const wearRecords = createWearRecords({ dialect });
  await wearRecords.migrate();
  const weather = new FakeWeather();
  const recommender = createOutfitRecommender({ wardrobe, weather, wearRecords, today: () => today });

  const signedIn = new Map<string, Headers>();

  async function createUser(email: string) {
    google.addAccount({ email, name: email });
    const { headers } = await signInWithGoogle(email);
    const user = await account.getCurrentUser(headers);
    signedIn.set(user!.id, headers);
    return user!.id;
  }

  // 탈퇴 for a user made with createUser.
  async function deleteAccount(userId: string) {
    await account.deleteAccount(signedIn.get(userId)!);
  }

  // Adds clothes to a user's 옷장, filling in unremarkable defaults.
  async function addClothes(userId: string, clothes: (Partial<NewClothing> & Pick<NewClothing, "name" | "slot">)[]) {
    const added = [];
    for (const clothing of clothes) {
      added.push(
        await wardrobe.addClothing(userId, {
          color: "black",
          seasons: ["spring", "summer", "autumn", "winter"],
          style: "casual",
          formality: "casual",
          warmth: 2,
          material: "cotton",
          ...clothing,
        }),
      );
    }
    return added;
  }

  return { wardrobe, weather, recommender, createUser, deleteAccount, addClothes };
}

// Seoul, where the tests' users live.
export const SEOUL = { latitude: 37.5665, longitude: 126.978 };

// Forecasts set per date; any other date has no forecast (예보 없음).
class FakeWeather implements WeatherSource {
  private forecasts = new Map<string, Weather>();
  private failure: Error | null = null;
  requests: { date: string; latitude: number; longitude: number }[] = [];

  setForecast(date: string, weather: Weather) {
    this.forecasts.set(date, weather);
  }

  failWith(error = new Error("weather service is down")) {
    this.failure = error;
  }

  async forecast(request: { date: string; latitude: number; longitude: number }) {
    this.requests.push(request);
    if (this.failure) throw this.failure;
    return this.forecasts.get(request.date) ?? null;
  }
}
