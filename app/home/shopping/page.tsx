import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { getAccount } from "@/lib/account/server";
import { COLOR_NAMES, COLOR_SWATCHES, SLOT_NAMES } from "@/lib/outfit/clothing-names";
import { purchaseConditionKey, purchaseConditionLabel } from "@/lib/outfit/purchase";
import type { PurchaseConversation, PurchaseOutfit, PurchaseRecommendation } from "@/lib/outfit/recommender";
import { getOutfitRecommender } from "@/lib/outfit/server";
import { isEventKind } from "@/lib/outfit/situations";
import type { Clothing, Slot } from "@/lib/outfit/wardrobe";
import { ClothingPhoto } from "../../clothing-photo";
import { restoreSuggestedClothing } from "../../wardrobe/analysis/actions";
import { homeDate, undoTargets } from "../home-state";
import { revisePurchase, undoPurchase } from "./actions";

const SLOT_ORDER: Slot[] = ["outer", "top", "bottom", "dress", "shoes"];

// 구매 추천 코디 for the date and 일정 the main screen was showing, and 구매
// 대화 about them.
export default function Shopping({ searchParams }: PageProps<"/home/shopping">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-6 py-12">
      <Suspense fallback={<p className="text-sm text-zinc-500">구매 추천 코디를 만드는 중…</p>}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Content({ searchParams }: Pick<PageProps<"/home/shopping">, "searchParams">) {
  const params = await searchParams;
  const requestHeaders = await headers();
  const user = await getAccount().getCurrentUser(requestHeaders);
  if (!user) redirect("/?next=/home");
  if (!user.homeRegion) redirect("/onboarding");
  const date = homeDate(params.date);
  const situation = isEventKind(params.situation) ? params.situation : null;
  const back = `/home?${new URLSearchParams({ date, ...(situation && { situation }) })}`;

  const recommender = getOutfitRecommender();
  // The 구매 추천 세션 being talked about, if it is still there, else a fresh one.
  const sessionId = typeof params.session === "string" ? params.session : null;
  const continued = sessionId && (await recommender.latestPurchase({ userId: user.id, sessionId }));
  const result =
    continued && continued.date === date
      ? continued
      : await recommender.purchaseOutfits({
          userId: user.id,
          date,
          situation,
          location: { latitude: user.homeRegion.latitude, longitude: user.homeRegion.longitude },
        });
  const notice = continued ? noticeText(params.notice, params.direction) : null;

  const hidden = (
    <>
      <input type="hidden" name="date" value={date} />
      {situation && <input type="hidden" name="situation" value={situation} />}
      <input type="hidden" name="session" value={result.sessionId} />
    </>
  );

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{date} 구매 추천</h1>
        <Link href={back} className="text-sm text-zinc-600 underline dark:text-zinc-400">
          내 옷장 코디로
        </Link>
      </div>
      {result.conversation && <Conversation conversation={result.conversation} />}
      <Outfits result={result} />
      <ChatForm hidden={hidden} notice={notice} />
      <UndoButtons step={result.step} hidden={hidden} />
    </>
  );
}

function Outfits({ result }: { result: PurchaseRecommendation }) {
  if (result.kind === "unavailable") {
    return <p className="text-zinc-600 dark:text-zinc-400">지금은 구매 추천을 만들 수 없어요. 잠시 뒤에 다시 시도해 주세요.</p>;
  }
  if (!result.outfits.length) {
    return (
      <p className="text-zinc-600 dark:text-zinc-400">
        {result.kind === "all-new" ? "추천할 코디를 찾지 못했어요." : "지금 옷장과 잘 어울릴 새 옷을 찾지 못했어요."}
      </p>
    );
  }
  return (
    <>
      {!result.conversation && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {result.kind === "all-new"
            ? "지금 옷장으로는 이날의 코디를 만들 수 없어서, 새 옷으로만 된 코디를 보여 드려요."
            : "가진 옷에 한 벌만 더한 코디예요. 새 옷이 가진 옷 몇 벌과 새로 어울리는지도 함께 보여 드려요."}
        </p>
      )}
      <ul className="flex flex-col gap-4">
        {result.outfits.map((item) => (
          <PurchaseCard key={item.added.map((a) => a.clothing.id).join()} item={item} />
        ))}
      </ul>
    </>
  );
}

function PurchaseCard({ item }: { item: PurchaseOutfit }) {
  const addedOf = (clothing: Clothing) => item.added.find((a) => a.clothing.id === clothing.id);
  const owned = Object.values(item.outfit).some((c) => !addedOf(c));
  return (
    <li
      className={`flex flex-col gap-3 rounded-xl border p-4 ${owned ? "border-zinc-200 dark:border-zinc-800" : "border-dashed border-zinc-300 dark:border-zinc-700"}`}
    >
      <div className="flex flex-wrap gap-3">
        {SLOT_ORDER.flatMap((slot) => {
          const clothing = item.outfit[slot as keyof typeof item.outfit];
          if (!clothing) return [];
          const added = addedOf(clothing);
          return added?.kind === "new" ? (
            <NewPiece key={slot} clothing={clothing} />
          ) : (
            <div key={slot} className="flex w-20 flex-col items-center gap-1">
              <ClothingPhoto clothing={clothing} className="h-20 w-20" />
              <span className="text-center text-xs">
                {added ? "정리한 옷 · " : ""}
                {clothing.name}
              </span>
            </div>
          );
        })}
      </div>
      {owned &&
        item.added.map(({ kind, clothing, matchesOwned }) => (
          <div key={clothing.id} className="flex flex-wrap items-center gap-2 text-sm">
            <p>
              {kind === "new"
                ? `${clothing.name}이(가) 있으면 가진 옷 ${matchesOwned}벌과 새로 어울려요.`
                : `정리한 ${clothing.name}을(를) 되돌리면 가진 옷 ${matchesOwned}벌과 어울려요. 새로 사지 않아도 돼요.`}
            </p>
            {kind === "restore" && (
              <form action={restoreSuggestedClothing}>
                <input type="hidden" name="clothingId" value={clothing.id} />
                <input type="hidden" name="returnTo" value="/home" />
                <button type="submit" className="underline">
                  되돌리기
                </button>
              </form>
            )}
          </div>
        ))}
    </li>
  );
}

function NewPiece({ clothing }: { clothing: Clothing }) {
  return (
    <div className="flex w-20 flex-col items-center gap-1">
      <span
        aria-label={COLOR_NAMES[clothing.color]}
        className="flex h-20 w-20 items-end justify-center rounded-lg border border-dashed border-zinc-400 pb-1 text-[10px] text-white"
        style={{ backgroundColor: COLOR_SWATCHES[clothing.color] }}
      >
        <span className="rounded bg-black/50 px-1">옷장에 없음</span>
      </span>
      <span className="text-center text-xs">
        {SLOT_NAMES[clothing.slot]} · {clothing.name}
      </span>
    </div>
  );
}

// The last 구매 대화 turn: what the user said, the 비서 답장, and every 구매
// 조건 kept so far.
function Conversation({ conversation: { message, reply, conditions } }: { conversation: PurchaseConversation }) {
  return (
    <section aria-label="구매 대화" className="flex flex-col gap-2 text-sm">
      <p className="self-end rounded-2xl rounded-br-sm bg-foreground px-4 py-2 text-background">{message}</p>
      <p className="self-start rounded-2xl rounded-bl-sm bg-zinc-100 px-4 py-2 dark:bg-zinc-800">{reply}</p>
      {conditions.length > 0 && (
        <ul aria-label="구매 조건" className="flex flex-wrap gap-2">
          {conditions.map((condition) => (
            <li
              key={purchaseConditionKey(condition)}
              className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            >
              {purchaseConditionLabel(condition)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ChatForm({ hidden, notice }: { hidden: ReactNode; notice: string | null }) {
  return (
    <form action={revisePurchase} className="flex flex-col gap-2">
      {hidden}
      <label htmlFor="purchase-message" className="text-sm font-medium">
        AI 비서에게 말하기
      </label>
      <div className="flex gap-2">
        <input
          id="purchase-message"
          name="message"
          required
          maxLength={200}
          placeholder="예: 아우터로 추천해 줘, 더 밝은 색으로, 바지랑 신발 둘 다 새로"
          className="h-10 flex-1 rounded-md border border-zinc-300 bg-transparent px-3 dark:border-zinc-700"
        />
        <button type="submit" className="h-10 rounded-full bg-foreground px-5 text-background">
          보내기
        </button>
      </div>
      {notice && (
        <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
          {notice}
        </p>
      )}
    </form>
  );
}

function UndoButtons({ step, hidden }: { step: number; hidden: ReactNode }) {
  const targets = undoTargets(step);
  if (!targets.length) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {targets.map((target) => (
        <form key={target} action={undoPurchase}>
          {hidden}
          <input type="hidden" name="step" value={target} />
          <button type="submit" className="h-9 rounded-full border border-zinc-300 px-4 text-sm dark:border-zinc-700">
            {target === 0 ? "처음 구매 추천으로 되돌리기" : "한 단계 되돌리기"}
          </button>
        </form>
      ))}
    </div>
  );
}

// Why the last message changed nothing, from the URL the action sent back.
function noticeText(notice: unknown, direction: unknown) {
  switch (notice) {
    case "failed":
      return "말씀을 이해하지 못해 구매 추천을 그대로 두었어요. 다시 말씀해 주세요.";
    case "off-topic":
      return "구매 추천 코디에 대한 말씀만 도와드릴 수 있어요. 예: 아우터로 추천해 줘, 더 밝은 색으로";
    case "unknown-clothing":
      return "말씀하신 옷을 찾지 못해 구매 추천을 그대로 두었어요. 옷 이름으로 다시 말씀해 주세요.";
    case "style-limit":
      return `지금보다 더 ${direction === "casual" ? "캐주얼하게" : "포멀하게"} 바꿀 수 없어요. 구매 추천은 그대로 두었어요.`;
    case "unbuildable":
      return "그 조건에 맞는 구매 추천 코디를 찾지 못했어요. 구매 추천은 그대로 두었어요.";
    default:
      return null;
  }
}
