import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getAccount } from "@/lib/account/server";
import { verdictSentence } from "@/lib/outfit/analysis-sentences";
import { SLOT_NAMES } from "@/lib/outfit/clothing-names";
import { todayInKorea } from "@/lib/outfit/dates";
import { getOutfitRecommender, getWardrobeAnalysis } from "@/lib/outfit/server";
import { ClothingPhoto } from "../../../clothing-photo";

// One 안 입는 옷 with its 활용 코디, made on demand for today's weather.
export default function UnwornDetail({ params }: PageProps<"/wardrobe/analysis/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-6 py-12">
      <Link href="/wardrobe/analysis" className="self-start text-sm text-zinc-600 underline dark:text-zinc-400">
        옷장 분석으로
      </Link>
      <Suspense fallback={<div className="h-72" />}>
        <Detail params={params} />
      </Suspense>
    </main>
  );
}

async function Detail({ params }: Pick<PageProps<"/wardrobe/analysis/[id]">, "params">) {
  const { id } = await params;
  const requestHeaders = await headers();
  const user = await getAccount().getCurrentUser(requestHeaders);
  if (!user) redirect(`/?next=/wardrobe/analysis/${id}`);
  const item = (await getWardrobeAnalysis().analyze(user.id)).find((u) => u.clothing.id === id);
  if (!item) {
    return <p className="text-zinc-600 dark:text-zinc-400">이 옷은 요즘 잘 입고 계세요. 분석할 게 없어요.</p>;
  }

  const wantsOutfits = item.remedies.includes("styling-outfits");
  const formality = item.verdict.kind === "cause" && item.verdict.cause.type === "situation" ? item.verdict.cause.formality : null;
  const outfits =
    wantsOutfits && user.homeRegion
      ? await getOutfitRecommender().stylingOutfits({
          userId: user.id,
          clothingId: id,
          date: todayInKorea(),
          location: { latitude: user.homeRegion.latitude, longitude: user.homeRegion.longitude },
          formality,
        })
      : [];

  return (
    <>
      <div className="flex items-center gap-4">
        <ClothingPhoto clothing={item.clothing} className="h-24 w-24 shrink-0" />
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">{item.clothing.name}</h1>
          <p className="text-sm">{verdictSentence(item)}</p>
        </div>
      </div>
      {wantsOutfits && (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">이렇게 입어 보세요</h2>
          {outfits.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              지금 옷장으로는 이 옷과 함께 입을 코디를 만들 수 없어요. 함께 입을 옷을 등록해 보세요.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {outfits.map((outfit) => (
                <li
                  key={Object.values(outfit)
                    .map((c) => c.id)
                    .join()}
                  className="flex flex-wrap gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
                >
                  {Object.entries(outfit).map(([slot, clothing]) => (
                    <div key={slot} className="flex w-16 flex-col items-center gap-1">
                      <ClothingPhoto clothing={clothing} className="h-16 w-16" />
                      <span className="text-center text-xs">
                        {SLOT_NAMES[slot as keyof typeof SLOT_NAMES]}·{clothing.name}
                      </span>
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          )}
          {outfits.length > 0 && (
            <Link href={`/home?fixed=${id}`} className="self-start rounded-full bg-foreground px-5 py-2 text-background">
              이 옷으로 추천받기
            </Link>
          )}
        </section>
      )}
    </>
  );
}
