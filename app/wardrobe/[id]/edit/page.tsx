import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { getAccount } from "@/lib/account/server";
import { getCloset } from "@/lib/outfit/server";
import { ClothingPhoto } from "../../../clothing-photo";
import { EditClothing } from "./edit-clothing";

export default function EditClothingPage({ params }: PageProps<"/wardrobe/[id]/edit">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-6 py-12">
      <h1 className="text-2xl font-semibold">옷 정보 고치기</h1>
      <Suspense fallback={<div className="h-72" />}>
        <Editor params={params} />
      </Suspense>
    </main>
  );
}

async function Editor({ params }: Pick<PageProps<"/wardrobe/[id]/edit">, "params">) {
  const { id } = await params;
  const requestHeaders = await headers();
  const user = await getAccount().getCurrentUser(requestHeaders);
  if (!user) redirect(`/?next=/wardrobe/${id}/edit`);
  const clothing = await getCloset().clothing(user.id, id);
  if (!clothing) notFound();
  return (
    <>
      <Link href={`/wardrobe/${id}`} className="self-start text-sm text-zinc-600 underline dark:text-zinc-400">
        고치지 않고 돌아가기
      </Link>
      <ClothingPhoto clothing={clothing} className="aspect-square w-full max-w-xs" />
      <EditClothing clothing={clothing} />
    </>
  );
}
