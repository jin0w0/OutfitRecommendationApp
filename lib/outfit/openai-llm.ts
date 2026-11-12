// The real LLM 어댑터: OpenAI's Responses API with Structured Outputs, so every
// answer is JSON in a fixed schema. Not tested automatically; check it by hand
// with OPENAI_API_KEY set.
import OpenAI from "openai";
import type { EventJudgement, EventText, LanguageModel, AskedCondition, RevisionRequest } from "./ports";
import type { Evidence } from "./scoring";
import { EVENT_KINDS, isEventKind } from "./situations";
import type { AskedPurchaseCondition, PurchaseReplyFacts, PurchaseRequest } from "./purchase";
import { COLORS, MATERIALS, SLOTS, type Color, type Formality, type Material, type Slot } from "./wardrobe";

const FORMALITIES: Formality[] = ["casual", "semi-formal", "formal"];

const JUDGE_INSTRUCTIONS = `너는 옷차림 추천 서비스에서 사용자의 캘린더 일정을 분류한다.
각 일정의 제목, 메모, 장소를 보고 일정의 종류(kind)와 그 자리에 맞는 옷차림의 격식 수준(formality)을 판단한다.
일정의 종류는 다음 중 가장 가까운 하나를 고른다: ${Object.entries(EVENT_KINDS)
  .map(([kind, { name }]) => `${kind}(${name})`)
  .join(", ")}.
격식 수준은 casual(캐주얼), semi-formal(세미 포멀), formal(포멀) 중 하나다. 일정의 종류가 같아도 내용에 따라 격식은 달라질 수 있다.
입력의 일정 순서 그대로, 일정마다 하나씩 답한다.`;

const REASON_INSTRUCTIONS = `너는 옷차림 추천 서비스에서 추천한 코디의 추천 이유를 사용자에게 설명한다.
입력의 reasons는 점수 계산에서 나온 근거다. 각 근거는 요소(factor), 관련 옷(clothes), 사실값(facts)으로 이루어진다.
요소는 weather(날씨 적합성: 기온 temperature °C와 비 소식 rain에 맞는 두께 warmth 1~3과 소재 material), event(일정과의 연관성: 일정의 종류 kind와 격식 수준 formality, 일정 제목 title), color(색상 조합: 코디의 색 colors와 그중 무채색이 아닌 포인트 색 accents), style(스타일 일관성: 공통 스타일 style), preference(선호도: 사용자가 좋아하는 색 colors와 스타일 styles), recency(최근 days일 동안 입지 않은 옷), utilization(days일 넘게 입지 않은 옷)이다.
recency와 utilization의 facts.estimated는 착용 기록이 없어 사용자가 답한 평소 착용 빈도로 판단한 옷의 id다. 이 옷들에는 날짜나 일수를 말하지 말고 "평소 자주 입지 않는다고 하신 옷"처럼 말한다.
일정의 종류 이름: ${Object.entries(EVENT_KINDS)
  .map(([kind, { name }]) => `${kind}=${name}`)
  .join(", ")}. 격식 수준 이름: casual=캐주얼, semi-formal=세미 포멀, formal=포멀.
근거마다 한국어로 짧은 한 문장을 쓴다. 옷은 이름으로 부른다. 근거에 없는 사실은 절대 더하지 않는다.
입력의 근거 순서 그대로, 근거마다 하나씩 답한다.`;

const REVISION_INSTRUCTIONS = `너는 옷차림 추천 서비스에서 사용자가 추천받은 코디를 고쳐 달라고 한 말을 수정 조건으로 바꾼다.
입력의 message는 사용자의 말, outfit은 사용자가 보고 있는 코디의 옷, wardrobe는 사용자의 옷장 전체다. 옷마다 id, 이름(name), 종류(slot: top 상의, bottom 하의, dress 원피스, outer 아우터, shoes 신발), 색(color), 격식 수준(formality)이 있다.
수정 조건의 종류(type)는 다음과 같다.
- style: 더 캐주얼하게(direction=casual) 또는 더 포멀하게(direction=formal).
- color: 더 밝은 색으로(direction=lighter) 또는 더 어두운 색으로(direction=darker).
- exclude: 이 옷은 빼 달라. clothingId에 그 옷의 id를 쓴다. "이 바지 말고", "바지만 바꿔줘"는 outfit의 그 바지를 뺀다.
- keep: 이 옷은 꼭 입겠다. clothingId에 그 옷의 id를 쓴다.
- off-topic: 코디 수정과 관계없는 말이다("오늘 점심 뭐 먹지?"). 이때는 이 조건 하나만 답한다.
옷을 가리키는 말은 먼저 outfit에서, 없으면 wardrobe에서 찾는다. 어떤 옷인지 알 수 없으면 그 조건은 쓰지 않는다. 쓰지 않는 필드(direction 또는 clothingId)는 null로 둔다.
사용자가 말한 순서대로 조건을 답한다. 코디를 직접 고르지 않는다.`;

const PURCHASE_INSTRUCTIONS = `너는 옷차림 추천 서비스에서 사용자가 구매 추천 코디(가진 옷에 새로 살 옷을 더한 코디)를 바꿔 달라고 한 말을 구매 조건으로 바꾼다.
입력의 message는 사용자의 말, outfits는 사용자가 보고 있는 구매 추천 코디들, wardrobe는 사용자의 옷장 전체다. 옷마다 id, 이름(name), 종류(slot: top 상의, bottom 하의, dress 원피스, outer 아우터, shoes 신발), 색(color), 격식 수준(formality)이 있고, outfits의 옷 중 added가 true인 옷은 아직 없는 새 옷이다.
구매 조건의 종류(type)는 다음과 같다.
- slots: 새 옷의 종류. "아우터로 추천해 줘"는 slots=["outer"], "바지랑 신발 둘 다 새로"는 slots=["bottom","shoes"]. 전부 새 옷으로 해 달라면 all=true.
- color: 새 옷을 더 밝은 색으로(direction=lighter) 또는 더 어두운 색으로(direction=darker).
- color-name: 새 옷을 특정 색으로. color에 색 값을 쓴다.
- material: 새 옷을 특정 소재로. material에 소재 값을 쓴다.
- style: 더 캐주얼하게(direction=casual) 또는 더 포멀하게(direction=formal).
- keep: 이 옷은 꼭 넣어 달라("내 네이비 셔츠랑 어울리게", "이 니트 좋다"). clothingId에 그 옷의 id를 쓴다.
- exclude: 이 옷은 빼 달라("이 바지 말고"). clothingId에 그 옷의 id를 쓴다.
- off-topic: 옷이나 코디와 관계없는 말이다. 이때는 이 조건 하나만 답한다.
옷을 가리키는 말은 먼저 outfits에서, 없으면 wardrobe에서 찾는다. 어떤 옷인지 알 수 없으면 그 조건은 쓰지 않는다. 쓰지 않는 필드는 null로 둔다.
사용자가 말한 순서대로 조건을 답한다. 코디나 옷을 직접 고르지 않는다.`;

const REPLY_INSTRUCTIONS = `너는 옷차림 추천 서비스의 친절한 AI 비서다. 사용자가 구매 추천 코디를 바꿔 달라고 했고, 서비스가 그 조건으로 코디를 다시 골랐다.
입력의 message는 사용자의 말, conditions는 지금까지 걸린 조건, outfits는 새로 고른 코디들이다. 코디마다 added는 더한 옷(name, 가진 옷 몇 벌과 새로 어울리는지 matchesOwned, 정리한 옷을 되돌리는 것이면 restore=true), owned는 함께 입는 가진 옷의 이름이다.
사용자에게 한국어 존댓말로 한두 문장의 친근한 답장을 쓴다. 무엇을 반영했는지와 첫 코디의 더한 옷을 말한다. 입력에 없는 사실(가격, 브랜드, 날씨 등)은 절대 더하지 않는다.`;

export function createOpenAiLanguageModel({
  apiKey,
  model = "gpt-5-mini",
}: {
  apiKey: string;
  model?: string;
}): LanguageModel {
  const client = new OpenAI({ apiKey, maxRetries: 1, timeout: 20_000 });

  // One structured answer to `input`, in the JSON schema `schema`.
  async function structured(name: string, instructions: string, input: unknown, schema: object) {
    const response = await client.responses.create({
      model,
      instructions,
      input: JSON.stringify(input),
      text: { format: { type: "json_schema", name, schema: { ...schema }, strict: true } },
    });
    return JSON.parse(response.output_text) as unknown;
  }

  return {
    async judgeEvents(events: EventText[]): Promise<EventJudgement[]> {
      const answer = (await structured("event_judgements", JUDGE_INSTRUCTIONS, { events }, {
        type: "object",
        properties: {
          judgements: {
            type: "array",
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: Object.keys(EVENT_KINDS) },
                formality: { type: "string", enum: FORMALITIES },
              },
              required: ["kind", "formality"],
              additionalProperties: false,
            },
          },
        },
        required: ["judgements"],
        additionalProperties: false,
      })) as { judgements: { kind: unknown; formality: unknown }[] };
      return answer.judgements.map(({ kind, formality }) => {
        if (!isEventKind(kind) || !FORMALITIES.includes(formality as Formality)) {
          throw new Error("The LLM answered outside the schema");
        }
        return { kind, formality: formality as Formality };
      });
    },

    async interpretRevision({ message, outfit, wardrobe }: RevisionRequest): Promise<AskedCondition[]> {
      const piece = ({ id, name, slot, color, formality }: RevisionRequest["wardrobe"][number]) => ({
        id,
        name,
        slot,
        color,
        formality,
      });
      const answer = (await structured(
        "revision_conditions",
        REVISION_INSTRUCTIONS,
        { message, outfit: outfit.map(piece), wardrobe: wardrobe.map(piece) },
        {
          type: "object",
          properties: {
            conditions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["style", "color", "exclude", "keep", "off-topic"] },
                  direction: { type: ["string", "null"], enum: ["casual", "formal", "lighter", "darker", null] },
                  clothingId: { type: ["string", "null"] },
                },
                required: ["type", "direction", "clothingId"],
                additionalProperties: false,
              },
            },
          },
          required: ["conditions"],
          additionalProperties: false,
        },
      )) as { conditions: { type: unknown; direction: unknown; clothingId: unknown }[] };
      return answer.conditions.map(({ type, direction, clothingId }): AskedCondition => {
        if (type === "style" && (direction === "casual" || direction === "formal")) return { type, direction };
        if (type === "color" && (direction === "lighter" || direction === "darker")) return { type, direction };
        if ((type === "exclude" || type === "keep") && typeof clothingId === "string") return { type, clothingId };
        if (type === "off-topic") return { type };
        throw new Error("The LLM answered outside the schema");
      });
    },

    async interpretPurchase({ message, outfits, addedIds, wardrobe }: PurchaseRequest): Promise<AskedPurchaseCondition[]> {
      const piece = ({ id, name, slot, color, formality }: PurchaseRequest["wardrobe"][number]) => ({
        id,
        name,
        slot,
        color,
        formality,
      });
      const answer = (await structured(
        "purchase_conditions",
        PURCHASE_INSTRUCTIONS,
        {
          message,
          outfits: outfits.map((o) => o.map((c) => ({ ...piece(c), added: addedIds.includes(c.id) }))),
          wardrobe: wardrobe.map(piece),
        },
        {
          type: "object",
          properties: {
            conditions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: {
                    type: "string",
                    enum: ["slots", "color", "color-name", "material", "style", "keep", "exclude", "off-topic"],
                  },
                  slots: { type: ["array", "null"], items: { type: "string", enum: SLOTS } },
                  all: { type: ["boolean", "null"] },
                  direction: { type: ["string", "null"], enum: ["casual", "formal", "lighter", "darker", null] },
                  color: { type: ["string", "null"], enum: [...COLORS, null] },
                  material: { type: ["string", "null"], enum: [...MATERIALS, null] },
                  clothingId: { type: ["string", "null"] },
                },
                required: ["type", "slots", "all", "direction", "color", "material", "clothingId"],
                additionalProperties: false,
              },
            },
          },
          required: ["conditions"],
          additionalProperties: false,
        },
      )) as {
        conditions: {
          type: unknown;
          slots: unknown;
          all: unknown;
          direction: unknown;
          color: unknown;
          material: unknown;
          clothingId: unknown;
        }[];
      };
      return answer.conditions.map((c): AskedPurchaseCondition => {
        if (c.type === "slots" && c.all === true) return { type: "slots", slots: "all" };
        if (c.type === "slots" && Array.isArray(c.slots) && c.slots.length && c.slots.every((s) => SLOTS.includes(s))) {
          return { type: "slots", slots: [...new Set(c.slots as Slot[])] };
        }
        if (c.type === "style" && (c.direction === "casual" || c.direction === "formal")) {
          return { type: "style", direction: c.direction };
        }
        if (c.type === "color" && (c.direction === "lighter" || c.direction === "darker")) {
          return { type: "color", direction: c.direction };
        }
        if (c.type === "color-name" && COLORS.includes(c.color as Color)) return { type: "color-name", color: c.color as Color };
        if (c.type === "material" && MATERIALS.includes(c.material as Material)) {
          return { type: "material", material: c.material as Material };
        }
        if ((c.type === "keep" || c.type === "exclude") && typeof c.clothingId === "string") {
          return { type: c.type, clothingId: c.clothingId };
        }
        if (c.type === "off-topic") return { type: "off-topic" };
        throw new Error("The LLM answered outside the schema");
      });
    },

    async writePurchaseReply(facts: PurchaseReplyFacts): Promise<string> {
      const answer = (await structured("purchase_reply", REPLY_INSTRUCTIONS, facts, {
        type: "object",
        properties: { reply: { type: "string" } },
        required: ["reply"],
        additionalProperties: false,
      })) as { reply: unknown };
      if (typeof answer.reply !== "string") throw new Error("The LLM answered outside the schema");
      return answer.reply;
    },

    async writeReasons(evidence: Evidence[]): Promise<string[]> {
      // Only what the sentences may mention: no clothing ids.
      const reasons = evidence.map(({ factor, clothes, facts }) => ({
        factor,
        clothes: clothes.map(({ id, ...clothing }) => (void id, clothing)),
        facts,
      }));
      const answer = (await structured("reason_sentences", REASON_INSTRUCTIONS, { reasons }, {
        type: "object",
        properties: { sentences: { type: "array", items: { type: "string" } } },
        required: ["sentences"],
        additionalProperties: false,
      })) as { sentences: unknown[] };
      if (!answer.sentences.every((s) => typeof s === "string")) {
        throw new Error("The LLM answered outside the schema");
      }
      return answer.sentences as string[];
    },
  };
}
