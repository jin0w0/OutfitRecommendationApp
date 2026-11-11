// Asks the real 사진 분석 AI about one photo and prints what it saw.
// Run with: npm run check:vision -- <path to a .jpg/.png/.webp>
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { createOpenAiClothingVision } from "../lib/outfit/openai-vision.ts";

const path = process.argv[2];
if (!path) throw new Error("Usage: npm run check:vision -- <photo>");
const contentType = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" }[
  extname(path).toLowerCase()
];
if (!contentType) throw new Error("Only .jpg, .png or .webp");
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("Missing environment variable OPENAI_API_KEY");

const vision = createOpenAiClothingVision({ apiKey, model: process.env.OPENAI_MODEL || undefined });
console.log(JSON.stringify(await vision.look({ bytes: readFileSync(path), contentType }), null, 2));
