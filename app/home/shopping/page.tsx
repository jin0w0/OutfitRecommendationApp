import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { getAccount } from "@/lib/account/server";
import { purchaseConditionKey, purchaseConditionLabel } from "@/lib/outfit/purchase";
import type { PurchaseConversation, PurchaseRecommendation } from "@/lib/outfit/recommender";
import { getOutfitRecommender } from "@/lib/outfit/server";
import { isEventKind } from "@/lib/outfit/situations";
import { PurchaseOutfitCard } from "../../purchase-outfit-card";
import { homeDate, undoTargets } from "../home-state";
import { revisePurchase, undoPurchase } from "./actions";

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
          // 구매 추천에서 더 보기 from the 옷장 분석.
          fixedClothingId: typeof params.fixed === "string" ? params.fixed : undefined,
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
          {result.fixed
            ? `${result.fixed.name}에 한 벌만 더한 코디예요. 바꾸고 싶은 점은 AI 비서에게 말해 주세요.`
            : result.kind === "all-new"
            ? "지금 옷장으로는 이날의 코디를 만들 수 없어서, 새 옷으로만 된 코디를 보여 드려요."
            : "가진 옷에 한 벌만 더한 코디예요. 새 옷이 가진 옷 몇 벌과 새로 어울리는지도 함께 보여 드려요."}
        </p>
      )}
      <ul className="flex flex-col gap-4">
        {result.outfits.map((item) => (
          <PurchaseOutfitCard key={item.added.map((a) => a.clothing.id).join()} item={item} returnTo="/home" />
        ))}
      </ul>
    </>
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
