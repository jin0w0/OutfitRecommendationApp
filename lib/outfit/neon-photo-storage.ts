// The real 사진 저장소 어댑터: a private bucket in Neon Object Storage, spoken
// to over the S3 API as Neon's docs set it up (path-style addressing, checksums
// only when required). Not tested automatically; `npm run check:photos` puts,
// reads and removes a photo in the real bucket.
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Photo, PhotoStorage } from "./closet-ports.ts";

export function createNeonPhotoStorage({
  endpoint,
  region,
  accessKeyId,
  secretAccessKey,
  bucket,
}: {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}): PhotoStorage {
  const s3 = new S3Client({
    endpoint,
    region,
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: { accessKeyId, secretAccessKey },
  });

  return {
    async put(key: string, { bytes, contentType }: Photo) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType }));
    },

    async exists(key: string) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (error) {
        if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) return false;
        throw error;
      }
    },

    async remove(key: string) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    async removeAll(prefix: string) {
      let token: string | undefined;
      do {
        const page = await s3.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
        );
        const keys = (page.Contents ?? []).flatMap((object) => (object.Key ? [{ Key: object.Key }] : []));
        if (keys.length > 0) {
          await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }));
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    },

    readURL(key: string, expiresInSeconds: number) {
      return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: expiresInSeconds,
      });
    },
  };
}
