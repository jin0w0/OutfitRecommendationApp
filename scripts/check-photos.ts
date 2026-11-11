// Checks the real 사진 저장소 against the bucket in .env: puts a tiny photo,
// reads it back through a short-lived URL, checks the bucket refuses anonymous
// reads, and removes it again. Run with: npm run check:photos
import { createNeonPhotoStorage } from "../lib/outfit/neon-photo-storage.ts";

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

const storage = createNeonPhotoStorage({
  endpoint: env("AWS_ENDPOINT_URL_S3"),
  region: env("AWS_REGION"),
  accessKeyId: env("AWS_ACCESS_KEY_ID"),
  secretAccessKey: env("AWS_SECRET_ACCESS_KEY"),
  bucket: env("CLOTHING_PHOTO_BUCKET"),
});

const prefix = `check/${Date.now()}/`;
const key = `${prefix}photo.jpg`;
const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

function check(ok: boolean, what: string) {
  console.log(`${ok ? "OK  " : "FAIL"} ${what}`);
  if (!ok) process.exitCode = 1;
}

try {
  await storage.put(key, { bytes, contentType: "image/jpeg" });
  check(await storage.exists(key), "put, then exists");

  const url = await storage.readURL(key, 300);
  const read = await fetch(url);
  const body = new Uint8Array(await read.arrayBuffer());
  check(read.ok && body.length === bytes.length, `read through a signed URL (${read.status})`);

  const anonymous = await fetch(url.split("?")[0]);
  check(anonymous.status >= 400, `anonymous read refused (${anonymous.status})`);

  await storage.removeAll(prefix);
  check(!(await storage.exists(key)), "removeAll by prefix");
} finally {
  await storage.removeAll(prefix);
}
