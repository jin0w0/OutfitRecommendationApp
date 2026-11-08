// The real LLM 어댑터: OpenAI's Responses API with Structured Outputs, so every
// answer is JSON in a fixed schema. Not tested automatically; check it by hand
// with OPENAI_API_KEY set.
import OpenAI from "openai";
import type { EventJudgement, EventText, Evidence, LanguageModel } from "./recommender";
import { EVENT_KINDS, isEventKind } from "./situations";
import type { Formality } from "./wardrobe";

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
일정의 종류 이름: ${Object.entries(EVENT_KINDS)
  .map(([kind, { name }]) => `${kind}=${name}`)
  .join(", ")}. 격식 수준 이름: casual=캐주얼, semi-formal=세미 포멀, formal=포멀.
근거마다 한국어로 짧은 한 문장을 쓴다. 옷은 이름으로 부른다. 근거에 없는 사실은 절대 더하지 않는다.
입력의 근거 순서 그대로, 근거마다 하나씩 답한다.`;

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
