/**
 * Safe Sharp wrapper — timeout + error handling for Sharp operations.
 *
 * Prevents Sharp from hanging indefinitely on corrupt files and converts
 * unhandled Sharp errors into catchable rejections instead of process crashes.
 */

const SHARP_TIMEOUT_MS = 30_000;

/**
 * Wrap a Sharp operation with timeout and error handling.
 * @param operation - async function that calls Sharp
 * @param context - human-readable label for logging (e.g. "media-processor:heic-to-jpeg")
 */
export async function safeSharp<T>(
  operation: () => Promise<T>,
  context: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Sharp timeout after ${SHARP_TIMEOUT_MS}ms in ${context}`));
    }, SHARP_TIMEOUT_MS);

    operation()
      .then(result => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(err => {
        clearTimeout(timer);
        reject(new Error(`Sharp error in ${context}: ${(err as Error).message}`));
      });
  });
}
