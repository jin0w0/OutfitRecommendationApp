// The real 사진 분석 AI 어댑터: OpenAI's Responses API with the photo as an
// image input and Structured Outputs, so the answer is JSON in a fixed schema
// whose fields may be null when the model is unsure. Not tested automatically;
// check it by hand with OPENAI_API_KEY set.
import OpenAI from "openai";
import type { ClothingSighting, ClothingVision, Photo } from "./closet-ports.ts";
import { COLORS, FORMALITIES, MATERIALS, SEASONS, SLOTS, STYLES, WARMTHS } from "./wardrobe.ts";

const INSTRUCTIONS = `너는 옷차림 추천 서비스에서 사용자가 올린 옷 사진 한 장을 보고 옷장에 넣을 정보를 채운다.
사진에 옷(신발 포함)이 한 벌 보이면 looksLikeClothing=true, 옷이 아니면 false로 하고 나머지는 모두 null로 둔다.
필드:
- name: 짧은 한국어 이름. 색과 종류를 담는다(예: "네이비 니트", "연청 청바지", "흰 운동화").
- slot: top 상의, bottom 하의, dress 원피스, outer 아우터, shoes 신발.
- color: 가장 넓게 보이는 색 하나. 무늬가 있어도 가장 넓은 색으로 고른다.
- seasons: 입기 알맞은 계절들(spring, summer, autumn, winter).
- style: casual 캐주얼, minimal 미니멀, classic 클래식, street 스트리트, sporty 스포티.
- formality: casual 캐주얼, semi-formal 세미 포멀, formal 포멀.
- warmth: 두께. 1 얇음, 2 보통, 3 두꺼움.
- material: 주 소재 하나. 여러 소재가 섞였으면 가장 많이 들어간 소재를 고르고, 라벨이 보이지 않으면 겉에서 가장 넓게 보이는 소재를 고른다(예: 폴리에스터와 울이 섞인 슬랙스는 더 많이 보이는 쪽).
사진만으로 확신할 수 없는 필드는 추측하지 말고 null로 둔다.`;

const nullable = (values: readonly (string | number)[]) => ({
  anyOf: [{ type: typeof values[0] === "number" ? "integer" : "string", enum: values }, { type: "null" }],
});

const SCHEMA = {
  type: "object",
  properties: {
    looksLikeClothing: { type: "boolean" },
    clothing: {
      type: "object",
      properties: {
        name: { type: ["string", "null"] },
        slot: nullable(SLOTS),
        color: nullable(COLORS),
        seasons: { anyOf: [{ type: "array", items: { type: "string", enum: SEASONS } }, { type: "null" }] },
        style: nullable(STYLES),
        formality: nullable(FORMALITIES),
        warmth: nullable(WARMTHS),
        material: nullable(MATERIALS),
      },
      required: ["name", "slot", "color", "seasons", "style", "formality", "warmth", "material"],
      additionalProperties: false,
    },
  },
  required: ["looksLikeClothing", "clothing"],
  additionalProperties: false,
};

export function createOpenAiClothingVision({
  apiKey,
  model = "gpt-5-mini",
}: {
  apiKey: string;
  model?: string;
}): ClothingVision {
  const client = new OpenAI({ apiKey, maxRetries: 1, timeout: 30_000 });

  return {
    async look({ bytes, contentType }: Photo): Promise<ClothingSighting> {
      const response = await client.responses.create({
        model,
        instructions: INSTRUCTIONS,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_image",
                // "low" is enough to tell a piece's kind and color, and cheaper.
                detail: "low",
                image_url: `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`,
              },
            ],
          },
        ],
        text: { format: { type: "json_schema", name: "clothing_sighting", schema: SCHEMA, strict: true } },
      });
      // The 옷장 module checks every field again against the value lists.
      return JSON.parse(response.output_text) as ClothingSighting;
    },
  };
}
