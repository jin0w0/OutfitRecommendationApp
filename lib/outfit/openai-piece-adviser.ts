// The real 한 벌 후보 어댑터: OpenAI's Responses API with Structured Outputs.
// It only proposes; the 이 한 벌 제안 module checks every value and decides by
// the score rules which candidates count. Not tested automatically.
import OpenAI from "openai";
import type { AdviserPreferences, DayConditions, PieceAdviser, PieceTarget } from "./one-more-piece";
import type { ClothingFields } from "./wardrobe";
import { COLORS, FORMALITIES, MATERIALS, SEASONS, SLOTS, STYLES, WARMTHS } from "./wardrobe";

const INSTRUCTIONS = `너는 옷차림 추천 서비스에서 사용자의 옷장에 없는 옷 한 벌을 제안한다. 목적은 사용자가 이미 가진 옷을 더 많이 입게 하는 것이다.
입력의 target이 revive이면, 그 옷과 함께 입어 색 조합과 스타일이 잘 어울리는 다른 종류의 옷을 제안한다. target이 fill이면, 그 종류(slot)의 옷을 제안해 옷장의 다른 옷과 코디가 되게 한다. target이 day이면, 그날의 격식 수준(formality, null이면 상관없음)과 기온(temperature °C)·비(rain)에 맞으면서 가진 옷과 함께 입기 좋은 옷을 제안한다.
target이 day이고 request가 있으면 사용자가 대화로 요청한 조건이다. 모든 후보가 그 조건을 지킨다: slots(새 옷의 종류 목록, "all"이면 코디의 모든 종류. 종류마다 2벌 이상), color(lighter 밝은 색, darker 어두운 색, 또는 색 값), material(소재 값). null은 상관없음이다.
wardrobe는 사용자가 가진 옷, preferences는 좋아하는 색(colors)과 스타일(styles), 추천받을 옷(line: menswear 남성복, womenswear 여성복, null 정하지 않음)이다. line이 정해져 있으면 그 옷만 제안한다. menswear이면 원피스(dress)는 절대 제안하지 않는다.
- 서로 다른 후보 6벌을 제안한다. 색이나 종류가 서로 겹치지 않게 한다.
- 사용자가 이미 가진 옷과 같은 옷(같은 종류·색·격식)은 제안하지 않는다.
- 무난하고 흔히 구할 수 있는 기본 아이템을 우선한다. 무채색(검정, 흰색, 회색, 네이비, 베이지, 갈색)은 다른 색과 잘 어울린다.
- name은 "베이지 치노 팬츠"처럼 색과 구체적인 아이템을 담은 짧은 한국어 이름이다.
- 각 필드는 정해진 값 중에서만 고른다. 두께 warmth는 1 얇음, 2 보통, 3 두꺼움이다.`;

const OUTFIT_INSTRUCTIONS = `너는 옷차림 추천 서비스에서 옷장이 거의 비어 있는 사용자에게 그날 입을 코디를 새 옷으로만 제안한다.
입력의 day는 그날의 격식 수준(formality, null이면 상관없음)과 기온(temperature °C)·비(rain), preferences는 좋아하는 색(colors)과 스타일(styles), 추천받을 옷(line: menswear 남성복, womenswear 여성복, null 정하지 않음)이다. line이 정해져 있으면 그 옷만 쓴다. menswear이면 원피스(dress)는 절대 쓰지 않는다.
- 서로 다른 코디 3벌을 제안한다. 각 코디(pieces)는 상의·하의·신발, 또는 원피스·신발로 이루어지고, 추우면 아우터를 더한다.
- 무난하고 흔히 구할 수 있는 기본 아이템을 우선하고, 색 조합과 스타일이 잘 어울리게 한다.
- name은 "베이지 치노 팬츠"처럼 색과 구체적인 아이템을 담은 짧은 한국어 이름이다.
- 각 필드는 정해진 값 중에서만 고른다. 두께 warmth는 1 얇음, 2 보통, 3 두꺼움이다.`;

const PIECE = {
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
};

const SCHEMA = {
  type: "object",
  properties: { candidates: { type: "array", items: PIECE } },
  required: ["candidates"],
  additionalProperties: false,
};

const OUTFITS_SCHEMA = {
  type: "object",
  properties: {
    outfits: {
      type: "array",
      items: {
        type: "object",
        properties: { pieces: { type: "array", items: PIECE } },
        required: ["pieces"],
        additionalProperties: false,
      },
    },
  },
  required: ["outfits"],
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
      preferences: AdviserPreferences;
    }) {
      const response = await client.responses.create({
        model,
        reasoning: { effort: "low" },
        instructions: INSTRUCTIONS,
        input: JSON.stringify({ target, wardrobe, preferences }),
        text: { format: { type: "json_schema", name: "piece_candidates", schema: SCHEMA, strict: true } },
      });
      return (JSON.parse(response.output_text) as { candidates: unknown[] }).candidates;
    },

    async proposeOutfits({ day, preferences }: { day: DayConditions; preferences: AdviserPreferences }) {
      const response = await client.responses.create({
        model,
        reasoning: { effort: "low" },
        instructions: OUTFIT_INSTRUCTIONS,
        input: JSON.stringify({ day, preferences }),
        text: { format: { type: "json_schema", name: "new_outfits", schema: OUTFITS_SCHEMA, strict: true } },
      });
      return (JSON.parse(response.output_text) as { outfits: unknown[] }).outfits;
    },
  };
}
