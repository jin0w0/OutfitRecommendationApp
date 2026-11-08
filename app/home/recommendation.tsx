import type { ReactNode } from "react";
import type {
  DayEvent,
  Factor,
  Outfit,
  Recommendation,
  Revision,
  RevisionCondition,
} from "@/lib/outfit/recommender";
import { acceptOutfit, cancelAcceptance, correctEvent, reviseOutfit, undoRevision } from "./actions";
import { EVENT_KINDS, FORMALITY_NAMES, type EventKind } from "@/lib/outfit/situations";
import { SLOT_NAMES, conditionLabel, type RevisionNotice } from "./revision-labels";

const SLOT_ORDER: (keyof Outfit)[] = ["outer", "top", "bottom", "dress", "shoes"];

// Plain GET form, so the chosen date and 일정 live in the URL.
export function OutfitRequestForm({
  date,
  situation,
}: {
  date: string;
  situation: EventKind | null;
}) {
  return (
    <form action="/home" className="flex flex-wrap items-center gap-3">
      <input
        type="date"
        name="date"
        defaultValue={date}
        aria-label="날짜"
        className="h-10 rounded-md border border-zinc-300 bg-transparent px-3 dark:border-zinc-700"
      />
      <select
        name="situation"
        defaultValue={situation ?? ""}
        aria-label="일정"
        className="h-10 rounded-md border border-zinc-300 bg-transparent px-3 dark:border-zinc-700"
      >
        <option value="">일정 없음</option>
        {Object.entries(EVENT_KINDS).map(([kind, { name }]) => (
          <option key={kind} value={kind}>
            {name}
          </option>
        ))}
      </select>
      <button type="submit" className="h-10 rounded-full bg-foreground px-5 text-background">
        추천받기
      </button>
    </form>
  );
}

export function RecommendationView({
  recommendation,
  regionName,
  situation,
  shown,
  notice,
}: {
  recommendation: Recommendation;
  // The 기본 지역, for weather not taken at an 일정's 장소.
  regionName: string;
  situation: EventKind | null;
  // 코디 already shown for this date, as clothing ids.
  shown: string[][];
  // Why the last 대화 message changed nothing, if it did not.
  notice: RevisionNotice | null;
}) {
  const { basis, date, accepted, revision } = recommendation;
  const hidden = (
    <>
      <input type="hidden" name="date" value={date} />
      {situation && <input type="hidden" name="situation" value={situation} />}
    </>
  );
  // As `hidden`, and back to this 추천 세션 afterwards.
  const inSession = (
    <>
      {hidden}
      <input type="hidden" name="session" value={recommendation.sessionId} />
    </>
  );
  return (
    <section className="flex flex-col gap-4">
      {accepted && (
        <div className="flex flex-col gap-3 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 dark:border-emerald-800 dark:bg-emerald-950">
          <p className="text-sm font-medium">
            {accepted.status === "worn" ? "이 날 입은 코디로 기록했어요" : "이 날 입을 계획으로 저장했어요"}
          </p>
          <p className="text-sm">{accepted.clothes.map((c) => c.name).join(", ")}</p>
          <form action={cancelAcceptance}>
            {inSession}
            <button type="submit" className="text-sm text-zinc-600 underline dark:text-zinc-400">
              수락 취소
            </button>
          </form>
        </div>
      )}
      <h2 className="font-medium">
        {date} 코디
        {basis && (
          <span className="ml-2 text-sm font-normal text-zinc-600 dark:text-zinc-400">
            {EVENT_KINDS[basis.kind].name} · {FORMALITY_NAMES[basis.formality]} 기준
          </span>
        )}
      </h2>
      <EventList recommendation={recommendation} hidden={hidden} />
      <WeatherLine recommendation={recommendation} regionName={regionName} />
      {revision && <RevisionSummary revision={revision} />}
      {recommendation.status === "ok" ? (
        <>
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {SLOT_ORDER.flatMap((slot) => {
              const clothing = recommendation.outfit[slot];
              if (!clothing) return [];
              return (
                <li key={slot} className="flex items-center gap-3 px-4 py-3">
                  <span className="w-14 text-sm text-zinc-500">{SLOT_NAMES[slot]}</span>
                  <span className="flex-1">{clothing.name}</span>
                  <span className="text-xs text-zinc-500">{FORMALITY_NAMES[clothing.formality]}</span>
                </li>
              );
            })}
          </ul>
          <Reasons recommendation={recommendation} />
          <div className="flex flex-wrap gap-3">
            <form action={acceptOutfit}>
              {inSession}
              {Object.values(recommendation.outfit).map((clothing) => (
                <input key={clothing.id} type="hidden" name="clothing" value={clothing.id} />
              ))}
              <button type="submit" className="h-10 rounded-full bg-foreground px-5 text-background">
                입을게요
              </button>
            </form>
            {/* Plain GET form: the 코디 shown so far live in the URL. */}
            <form action="/home">
              {hidden}
              {[
                ...new Set(
                  [...shown, Object.values(recommendation.outfit).map((c) => c.id)].map((ids) =>
                    ids.join("."),
                  ),
                ),
              ].map((value) => (
                <input key={value} type="hidden" name="shown" value={value} />
              ))}
              <button
                type="submit"
                className="h-10 rounded-full border border-zinc-300 px-5 dark:border-zinc-700"
              >
                다시 추천받기
              </button>
            </form>
          </div>
        </>
      ) : (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          옷장에 {recommendation.missingSlots.map((slot) => SLOT_NAMES[slot]).join(", ")}이(가)
          부족해서 {basis ? "이 일정에 맞는 " : ""}코디를 만들 수 없어요.
        </p>
      )}
      <RevisionForm hidden={inSession} notice={notice} />
      {recommendation.step > 0 && <UndoButtons step={recommendation.step} hidden={inSession} />}
    </section>
  );
}

// 되돌리기: one step back, or back to the first 추천.
function UndoButtons({ step, hidden }: { step: number; hidden: ReactNode }) {
  const targets = step > 1 ? [step - 1, 0] : [0];
  return (
    <div className="flex flex-wrap gap-3">
      {targets.map((target) => (
        <form key={target} action={undoRevision}>
          {hidden}
          <input type="hidden" name="step" value={target} />
          <button type="submit" className="h-9 rounded-full border border-zinc-300 px-4 text-sm dark:border-zinc-700">
            {target === 0 ? "처음 추천으로 되돌리기" : "한 단계 되돌리기"}
          </button>
        </form>
      ))}
    </div>
  );
}

// What to say when the last 대화 message changed nothing.
function noticeText(notice: RevisionNotice) {
  switch (notice.type) {
    case "revision-failed":
      return "요청을 이해하지 못해 코디를 그대로 두었어요. 다시 말씀해 주세요.";
    case "off-topic":
      return "코디와 관련된 요청만 도와드릴 수 있어요. 예: 좀 더 캐주얼하게, 이 바지 말고 다른 걸로";
    case "unbuildable": {
      const slots = notice.missingSlots.length
        ? ` (${notice.missingSlots.map((slot) => SLOT_NAMES[slot]).join(", ")}이(가) 부족해요)`
        : "";
      return `옷장의 옷으로는 "${notice.unmet.join(", ")}" 조건을 만족하는 코디를 만들 수 없어요${slots}. 코디는 그대로 두었어요.`;
    }
  }
}

// 대화로 수정하기: a message about the 코디 above.
function RevisionForm({ hidden, notice }: { hidden: ReactNode; notice: RevisionNotice | null }) {
  return (
    <form action={reviseOutfit} className="flex flex-col gap-2">
      {hidden}
      <label htmlFor="revision-message" className="text-sm font-medium">
        대화로 수정하기
      </label>
      <div className="flex gap-2">
        <input
          id="revision-message"
          name="message"
          required
          maxLength={200}
          placeholder="예: 좀 더 캐주얼하게, 이 바지 말고 다른 걸로"
          className="h-10 flex-1 rounded-md border border-zinc-300 bg-transparent px-3 dark:border-zinc-700"
        />
        <button type="submit" className="h-10 rounded-full bg-foreground px-5 text-background">
          보내기
        </button>
      </div>
      {notice && (
        <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
          {noticeText(notice)}
        </p>
      )}
    </form>
  );
}

// What the last message asked for, every 수정 조건 kept so far, and what changed.
function RevisionSummary({ revision: { message, conditions, changes, warnings } }: { revision: Revision }) {
  return (
    <section
      aria-label="수정 결과"
      className="flex flex-col gap-2 rounded-lg border border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800"
    >
      <p>
        <span className="text-zinc-500">요청</span> “{message}”
      </p>
      {conditions.length > 0 && (
        <ul aria-label="수정 조건" className="flex flex-wrap gap-2">
          {conditions.map((condition) => (
            <li
              key={conditionKey(condition)}
              className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            >
              {conditionLabel(condition)}
            </li>
          ))}
        </ul>
      )}
      {changes.length ? (
        <ul aria-label="바뀐 점" className="flex flex-col gap-1">
          {changes.map(({ slot, from, to, cause }) => (
            <li key={slot}>
              {SLOT_NAMES[slot]}: {from?.name ?? "없음"} → {to?.name ?? "없음"}
              <span className="text-zinc-500">
                {" "}
                ({cause ? `${conditionLabel(cause)} 요청에 따라` : "나머지 옷과 어울리도록"})
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-zinc-500">바뀐 옷은 없어요.</p>
      )}
      {/* Steps stored before 격식 충돌 경고 existed have no warnings. */}
      {(warnings ?? []).map(({ basis, conditions: clashing }) => (
        <p
          key={clashing.map(conditionKey).join()}
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          {EVENT_KINDS[basis.kind].name}({FORMALITY_NAMES[basis.formality]}) 일정과 격식이 맞지 않을 수 있어요:{" "}
          {clashing.map(conditionLabel).join(", ")}
        </p>
      ))}
    </section>
  );
}

function conditionKey(condition: RevisionCondition) {
  return "clothing" in condition ? `${condition.type}:${condition.clothing.id}` : condition.type;
}

const FACTOR_NAMES: Record<Factor, string> = {
  weather: "날씨",
  event: "일정",
  color: "색상 조합",
  style: "스타일",
  preference: "취향",
  recency: "최근 착용",
  utilization: "활용도",
};

// The 추천 이유, one short line each.
function Reasons({
  recommendation: { reasons, missing },
}: {
  recommendation: Extract<Recommendation, { status: "ok" }>;
}) {
  if (!reasons.length) return null;
  return (
    <section aria-label="추천 이유" className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">추천 이유</h3>
      <ul className="flex flex-col gap-1 text-sm">
        {reasons.map(({ evidence, sentence }) => (
          <li key={evidence.factor} className="flex gap-2">
            <span className="w-16 shrink-0 text-zinc-500">{FACTOR_NAMES[evidence.factor]}</span>
            <span>{sentence}</span>
          </li>
        ))}
      </ul>
      {missing.includes("reasons-llm-failed") && (
        <p className="text-xs text-zinc-500">추천 이유를 다듬지 못해 기본 문장으로 보여 드려요.</p>
      )}
    </section>
  );
}

// The day's 일정 from the calendar, each with its judged 일정의 종류 and 격식
// 수준 and the 기준 일정 marked, or why they could not be read or judged. Nothing for a user without 캘린더 연동 and no 일정.
// Each 일정's judgement can be corrected, which recommends again with it.
function EventList({
  recommendation: { events, baseEvent, missing },
  hidden,
}: {
  recommendation: Recommendation;
  // The date and picked 일정 to come back to.
  hidden: ReactNode;
}) {
  if (missing.includes("calendar-failed")) {
    return (
      <p className="rounded-lg border border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        캘린더 일정을 불러오지 못해 일정 없이 추천했어요.
      </p>
    );
  }
  if (!events.length) return null;
  return (
    <>
      {missing.includes("llm-failed") && (
        <p className="rounded-lg border border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          일정의 종류와 격식을 판단하지 못해 일정은 반영하지 않고 추천했어요.
        </p>
      )}
      <ul aria-label="이날의 일정" className="flex flex-col gap-2">
        {events.map((event) => (
          <li
            key={`${event.calendarId}/${event.id}`}
            className="flex flex-col rounded-lg border border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800"
          >
            <span className="flex items-center gap-2 font-medium">
              {event.title}
              {baseEvent?.calendarId === event.calendarId && baseEvent.id === event.id && (
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-normal text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                  기준 일정
                </span>
              )}
            </span>
            <span className="text-zinc-600 dark:text-zinc-400">
              {eventTime(event)}
              {event.location && ` · ${event.location}`}
            </span>
            {event.judgement && (
              <span className="text-zinc-600 dark:text-zinc-400">
                {EVENT_KINDS[event.judgement.kind].name} · {FORMALITY_NAMES[event.judgement.formality]}
              </span>
            )}
            <CorrectEventForm event={event} hidden={hidden} />
          </li>
        ))}
      </ul>
    </>
  );
}

// 일정 판단 직접 고치기: pick the 일정의 종류 and 격식 수준 and recommend again.
function CorrectEventForm({ event, hidden }: { event: DayEvent; hidden: ReactNode }) {
  const selectClass =
    "h-9 rounded-md border border-zinc-300 bg-transparent px-2 dark:border-zinc-700";
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs text-zinc-600 underline dark:text-zinc-400">
        {event.judgement ? "판단 고치기" : "직접 정하기"}
      </summary>
      <form action={correctEvent} className="mt-2 flex flex-wrap items-center gap-2">
        {hidden}
        <input type="hidden" name="eventId" value={event.id} />
        <select
          name="kind"
          required
          defaultValue={event.judgement?.kind ?? ""}
          aria-label="일정의 종류"
          className={selectClass}
        >
          <option value="" disabled>
            종류
          </option>
          {Object.entries(EVENT_KINDS).map(([kind, { name }]) => (
            <option key={kind} value={kind}>
              {name}
            </option>
          ))}
        </select>
        <select
          name="formality"
          required
          defaultValue={event.judgement?.formality ?? ""}
          aria-label="격식 수준"
          className={selectClass}
        >
          <option value="" disabled>
            격식
          </option>
          {Object.entries(FORMALITY_NAMES).map(([formality, name]) => (
            <option key={formality} value={formality}>
              {name}
            </option>
          ))}
        </select>
        <button type="submit" className="h-9 rounded-full bg-foreground px-4 text-sm text-background">
          고쳐서 다시 추천받기
        </button>
      </form>
    </details>
  );
}

function eventTime(event: DayEvent) {
  if (event.allDay) return "종일";
  const time = (iso: string) =>
    new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(iso));
  return `${time(event.start)}–${time(event.end)}`;
}

// The weather the 코디 was chosen for, or why it was not 반영.
function WeatherLine({
  recommendation: { weather, weatherPlace, missing },
  regionName,
}: {
  recommendation: Recommendation;
  regionName: string;
}) {
  if (weather) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {weatherPlace ?? regionName} 날씨 {weather.temperature}°C · {weather.rain ? "비 소식 있음" : "비 소식 없음"}
      </p>
    );
  }
  return (
    <p className="rounded-lg border border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
      {missing.includes("weather-failed")
        ? "날씨 정보를 불러오지 못해 날씨는 반영하지 않았어요."
        : "이 날짜는 아직 예보가 없어 날씨는 반영하지 않았어요."}
    </p>
  );
}
