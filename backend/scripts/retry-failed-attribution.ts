/**
 * One-shot script: retry all failed 'attribution' jobs in order-post-payment queue.
 * Run: npx tsx backend/scripts/retry-failed-attribution.ts
 */
import 'dotenv/config';
import { Queue } from 'bullmq';

const redisOpts = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
};

async function main() {
  const queue = new Queue('order-post-payment', { connection: redisOpts });

  const failed = await queue.getFailed(0, 200);
  const attribution = failed.filter(j => j.name === 'attribution');

  console.log(`Found ${attribution.length} failed attribution jobs`);

  if (attribution.length === 0) {
    await queue.close();
    return;
  }

  let ok = 0, err = 0;
  for (const job of attribution) {
    try {
      await job.retry();
      ok++;
    } catch (e) {
      console.error(`Failed to retry job ${job.id}:`, e);
      err++;
    }
  }

  console.log(`Retried: ${ok}, errors: ${err}`);
  await queue.close();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
