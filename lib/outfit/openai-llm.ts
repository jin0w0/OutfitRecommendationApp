// The real LLM 어댑터: OpenAI's Responses API with Structured Outputs, so every
// answer is JSON in a fixed schema. Not tested automatically; check it by hand
// with OPENAI_API_KEY set.
import OpenAI from "openai";
import type { EventJudgement, EventText, LanguageModel } from "./recommender";
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
  };
}
