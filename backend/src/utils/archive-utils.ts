import type archiver from 'archiver';
import type { Readable } from 'stream';

function errorFromUnknown(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function appendReadableToArchive(
  archive: archiver.Archiver,
  stream: Readable,
  archiveName: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let ended = false;

    const cleanup = () => {
      stream.off('end', onEnd);
      stream.off('error', onError);
      stream.off('close', onClose);
      archive.off('error', onError);
    };

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const onEnd = () => {
      ended = true;
      settle(resolve);
    };
    const onError = (error: unknown) => {
      settle(() => reject(errorFromUnknown(error)));
    };
    const onClose = () => {
      if (!ended) {
        settle(() => reject(new Error(`Archive source stream closed before completion: ${archiveName}`)));
      }
    };

    stream.once('end', onEnd);
    stream.once('error', onError);
    stream.once('close', onClose);
    archive.once('error', onError);

    try {
      archive.append(stream, { name: archiveName });
    } catch (error: unknown) {
      onError(error);
    }
  });
}
