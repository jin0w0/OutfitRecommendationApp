// The real 한 벌 후보 어댑터: OpenAI's Responses API with Structured Outputs.
// It only proposes; the 이 한 벌 제안 module checks every value and decides by
// the score rules which candidates count. Not tested automatically.
import OpenAI from "openai";
import type { PieceAdviser, PieceTarget } from "./one-more-piece";
import type { ClothingFields, Preferences } from "./wardrobe";
import { COLORS, FORMALITIES, MATERIALS, SEASONS, SLOTS, STYLES, WARMTHS } from "./wardrobe";

const INSTRUCTIONS = `너는 옷차림 추천 서비스에서 사용자의 옷장에 없는 옷 한 벌을 제안한다. 목적은 사용자가 이미 가진 옷을 더 많이 입게 하는 것이다.
입력의 target이 revive이면, 그 옷과 함께 입어 색 조합과 스타일이 잘 어울리는 다른 종류의 옷을 제안한다. target이 fill이면, 그 종류(slot)의 옷을 제안해 옷장의 다른 옷과 코디가 되게 한다.
wardrobe는 사용자가 가진 옷, preferences는 좋아하는 색과 스타일이다.
- 서로 다른 후보 6벌을 제안한다. 색이나 종류가 서로 겹치지 않게 한다.
- 사용자가 이미 가진 옷과 같은 옷(같은 종류·색·격식)은 제안하지 않는다.
- 무난하고 흔히 구할 수 있는 기본 아이템을 우선한다. 무채색(검정, 흰색, 회색, 네이비, 베이지, 갈색)은 다른 색과 잘 어울린다.
- name은 "베이지 치노 팬츠"처럼 색과 구체적인 아이템을 담은 짧은 한국어 이름이다.
- 각 필드는 정해진 값 중에서만 고른다. 두께 warmth는 1 얇음, 2 보통, 3 두꺼움이다.`;

const SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          slot: { type: "string", enum: SLOTS },
          color: { type: "string", enum: COLORS },
          seasons: { type: "array", items: { type: "string", enum: SEASONS } },
          style: { type: "string", enum: STYLES },
          formality: { type: "string", enum: FORMALITIES },
          warmth: { type: "integer", enum: WARMTHS },
          material: { type: "string", enum: MATERIALS },
        },
        required: ["name", "slot", "color", "seasons", "style", "formality", "warmth", "material"],
        additionalProperties: false,
      },
    },
  },
  required: ["candidates"],
  additionalProperties: false,
};

export function createOpenAiPieceAdviser({ apiKey, model = "gpt-5-mini" }: { apiKey: string; model?: string }): PieceAdviser {
  const client = new OpenAI({ apiKey, maxRetries: 1, timeout: 30_000 });

  return {
    async proposePieces({
      target,
      wardrobe,
      preferences,
    }: {
      target: PieceTarget;
      wardrobe: ClothingFields[];
      preferences: Preferences;
    }) {
      const response = await client.responses.create({
        model,
        instructions: INSTRUCTIONS,
        input: JSON.stringify({ target, wardrobe, preferences }),
        text: { format: { type: "json_schema", name: "piece_candidates", schema: SCHEMA, strict: true } },
      });
      return (JSON.parse(response.output_text) as { candidates: unknown[] }).candidates;
    },
  };
}
