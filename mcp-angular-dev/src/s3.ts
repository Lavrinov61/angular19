import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import {
  S3_DELETE_CONFIRM,
  S3_PRESIGN_PUT_CONFIRM,
  defaultS3Bucket,
  getS3Config,
  s3PublicUrl,
} from './config.js';
import { errorResponse, jsonResponse, toErrorMessage } from './response.js';

const s3 = new S3Client(getS3Config());

export function closeS3(): void {
  s3.destroy();
}

export function registerS3Tools(server: McpServer): void {
  server.tool('s3_list_buckets', 'List S3/MinIO buckets visible to current credentials.', {}, async () => {
    try {
      const result = await s3.send(new ListBucketsCommand({}));
      return jsonResponse({
        buckets: (result.Buckets ?? []).map((bucket) => ({
          name: bucket.Name,
          creationDate: bucket.CreationDate?.toISOString(),
        })),
      });
    } catch (error) {
      return errorResponse(toErrorMessage(error));
    }
  });

  server.tool(
    's3_head_bucket',
    'Check whether an S3/MinIO bucket is reachable.',
    {
      bucket: z.string().optional().default(defaultS3Bucket()),
    },
    async ({ bucket }) => {
      try {
        await s3.send(new HeadBucketCommand({ Bucket: bucket }));
        return jsonResponse({ bucket, reachable: true });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    's3_list_objects',
    'List S3/MinIO objects by prefix. Returns bounded page and next continuation token.',
    {
      bucket: z.string().optional().default(defaultS3Bucket()),
      prefix: z.string().optional().default(''),
      maxKeys: z.number().int().min(1).max(1000).optional().default(100),
      continuationToken: z.string().optional(),
      includePublicUrl: z.boolean().optional().default(false),
    },
    async ({ bucket, prefix, maxKeys, continuationToken, includePublicUrl }) => {
      try {
        const result = await s3.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix || undefined,
            MaxKeys: maxKeys,
            ContinuationToken: continuationToken,
          }),
        );
        const basePublicUrl = includePublicUrl ? s3PublicUrl() : '';
        const objects = (result.Contents ?? []).map((object) => ({
          key: object.Key,
          size: object.Size,
          lastModified: object.LastModified?.toISOString(),
          etag: object.ETag,
          storageClass: object.StorageClass,
          publicUrl: basePublicUrl && object.Key ? `${basePublicUrl}/${object.Key}` : undefined,
        }));

        return jsonResponse({
          bucket,
          prefix,
          keyCount: result.KeyCount,
          isTruncated: result.IsTruncated,
          nextContinuationToken: result.NextContinuationToken,
          objects,
          commonPrefixes: (result.CommonPrefixes ?? []).map((item) => item.Prefix),
        });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    's3_head_object',
    'HEAD an S3/MinIO object and return metadata, size, content type, and timestamps.',
    {
      bucket: z.string().optional().default(defaultS3Bucket()),
      key: z.string().min(1),
      includePublicUrl: z.boolean().optional().default(true),
    },
    async ({ bucket, key, includePublicUrl }) => {
      try {
        const result = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        const basePublicUrl = includePublicUrl ? s3PublicUrl() : '';
        return jsonResponse({
          bucket,
          key,
          contentLength: result.ContentLength,
          contentType: result.ContentType,
          lastModified: result.LastModified?.toISOString(),
          etag: result.ETag,
          metadata: result.Metadata,
          cacheControl: result.CacheControl,
          publicUrl: basePublicUrl ? `${basePublicUrl}/${key}` : undefined,
        });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    's3_presign_get',
    'Create a short-lived presigned GET URL for an S3/MinIO object.',
    {
      bucket: z.string().optional().default(defaultS3Bucket()),
      key: z.string().min(1),
      expiresSeconds: z.number().int().min(1).max(86400).optional().default(900),
    },
    async ({ bucket, key, expiresSeconds }) => {
      try {
        const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
          expiresIn: expiresSeconds,
        });
        return jsonResponse({ bucket, key, expiresSeconds, url });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    's3_bucket_usage',
    'Estimate S3/MinIO bucket usage by scanning objects. Bounded by maxObjects.',
    {
      bucket: z.string().optional().default(defaultS3Bucket()),
      prefix: z.string().optional().default(''),
      maxObjects: z.number().int().min(1).max(100000).optional().default(10000),
    },
    async ({ bucket, prefix, maxObjects }) => {
      try {
        let continuationToken: string | undefined;
        let objectCount = 0;
        let totalBytes = 0;
        let scannedPages = 0;
        const samples: Array<{ key?: string; size?: number; lastModified?: string }> = [];

        do {
          const result = await s3.send(
            new ListObjectsV2Command({
              Bucket: bucket,
              Prefix: prefix || undefined,
              MaxKeys: Math.min(1000, maxObjects - objectCount),
              ContinuationToken: continuationToken,
            }),
          );
          scannedPages += 1;
          for (const object of result.Contents ?? []) {
            objectCount += 1;
            totalBytes += object.Size ?? 0;
            if (samples.length < 20) {
              samples.push({
                key: object.Key,
                size: object.Size,
                lastModified: object.LastModified?.toISOString(),
              });
            }
          }
          continuationToken = result.NextContinuationToken;
        } while (continuationToken && objectCount < maxObjects);

        return jsonResponse({
          bucket,
          prefix,
          scannedPages,
          objectCount,
          totalBytes,
          totalMiB: Number((totalBytes / 1024 / 1024).toFixed(2)),
          truncated: Boolean(continuationToken),
          nextContinuationToken: continuationToken,
          samples,
        });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    's3_presign_put',
    `DANGEROUS: create a presigned PUT URL. Requires confirm="${S3_PRESIGN_PUT_CONFIRM}".`,
    {
      bucket: z.string().optional().default(defaultS3Bucket()),
      key: z.string().min(1),
      contentType: z.string().optional(),
      expiresSeconds: z.number().int().min(1).max(3600).optional().default(300),
      confirm: z.string().optional().default(''),
    },
    async ({ bucket, key, contentType, expiresSeconds, confirm }) => {
      if (confirm !== S3_PRESIGN_PUT_CONFIRM) {
        return errorResponse(`Refusing to create PUT URL. Pass confirm="${S3_PRESIGN_PUT_CONFIRM}".`);
      }
      try {
        const url = await getSignedUrl(
          s3,
          new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
          { expiresIn: expiresSeconds },
        );
        return jsonResponse({ bucket, key, contentType, expiresSeconds, url });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    's3_delete_objects',
    `DANGEROUS: delete one or more S3/MinIO objects. Requires confirm="${S3_DELETE_CONFIRM}".`,
    {
      bucket: z.string().optional().default(defaultS3Bucket()),
      keys: z.array(z.string().min(1)).min(1).max(1000),
      confirm: z.string().optional().default(''),
    },
    async ({ bucket, keys, confirm }) => {
      if (confirm !== S3_DELETE_CONFIRM) {
        return errorResponse(`Refusing to delete objects. Pass confirm="${S3_DELETE_CONFIRM}".`);
      }
      try {
        const result = await s3.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
              Objects: keys.map((Key) => ({ Key })),
              Quiet: false,
            },
          }),
        );
        return jsonResponse({
          bucket,
          deleted: result.Deleted,
          errors: result.Errors,
        });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );
}
