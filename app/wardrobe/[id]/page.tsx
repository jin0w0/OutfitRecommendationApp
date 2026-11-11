import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { getAccount } from "@/lib/account/server";
import {
  COLOR_NAMES,
  ESTIMATED_WEAR_FREQUENCY_NAMES,
  FORMALITY_NAMES,
  MATERIAL_NAMES,
  SEASON_NAMES,
  SLOT_NAMES,
  STYLE_NAMES,
  WARMTH_NAMES,
} from "@/lib/outfit/clothing-names";
import { getCloset } from "@/lib/outfit/server";
import { ClothingPhoto } from "../../clothing-photo";

export default function ClothingDetail({ params }: PageProps<"/wardrobe/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-6 py-12">
      <Link href="/wardrobe" className="self-start text-sm text-zinc-600 underline dark:text-zinc-400">
        옷장으로
      </Link>
      <Suspense fallback={<div className="h-72" />}>
        <Detail params={params} />
      </Suspense>
    </main>
  );
}

async function Detail({ params }: Pick<PageProps<"/wardrobe/[id]">, "params">) {
  const { id } = await params;
  const requestHeaders = await headers();
  const user = await getAccount().getCurrentUser(requestHeaders);
  if (!user) redirect(`/?next=/wardrobe/${id}`);
  const clothing = await getCloset().clothing(user.id, id);
  if (!clothing) notFound();

  const rows: [string, string][] = [
    ["종류", SLOT_NAMES[clothing.slot]],
    ["색상", COLOR_NAMES[clothing.color]],
    ["계절", clothing.seasons.map((s) => SEASON_NAMES[s]).join(", ")],
    ["스타일", STYLE_NAMES[clothing.style]],
    ["격식 수준", FORMALITY_NAMES[clothing.formality]],
    ["두께", WARMTH_NAMES[clothing.warmth]],
    ["소재", MATERIAL_NAMES[clothing.material]],
    [
      "평소 착용 빈도",
      clothing.estimatedWearFrequency ? ESTIMATED_WEAR_FREQUENCY_NAMES[clothing.estimatedWearFrequency] : "모름",
    ],
  ];
  return (
    <>
      <ClothingPhoto clothing={clothing} className="aspect-square w-full max-w-sm" />
      <h1 className="text-2xl font-semibold">{clothing.name}</h1>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-zinc-500">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
