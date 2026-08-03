import { Readable } from "node:stream";

function isBenignClose(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String(err.code) : "";
  return (
    code === "ERR_STREAM_PREMATURE_CLOSE" ||
    code === "ERR_INVALID_STATE" ||
    code === "ABORT_ERR"
  );
}

/**
 * Bridge a Node Readable into a Web ReadableStream that tolerates client
 * disconnects. Next can close the response controller before the Node side
 * stops pushing; without this, that race surfaces as uncaught
 * ERR_INVALID_STATE ("Controller is already closed").
 */
export function nodeToWebStream(
  nodeStream: Readable,
  signal?: AbortSignal
): ReadableStream<Uint8Array> {
  const destroy = () => {
    if (!nodeStream.destroyed) nodeStream.destroy();
  };

  if (signal) {
    if (signal.aborted) destroy();
    else signal.addEventListener("abort", destroy, { once: true });
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const onData = (chunk: Buffer | Uint8Array) => {
        try {
          controller.enqueue(
            chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
          );
          if (
            controller.desiredSize !== null &&
            controller.desiredSize <= 0
          ) {
            nodeStream.pause();
          }
        } catch {
          destroy();
        }
      };

      const onEnd = () => {
        try {
          controller.close();
        } catch {
          // already closed by cancel/abort
        }
      };

      const onError = (err: Error) => {
        if (signal?.aborted || isBenignClose(err)) {
          try {
            controller.close();
          } catch {
            // already closed
          }
          return;
        }
        try {
          controller.error(err);
        } catch {
          // already closed
        }
      };

      nodeStream.on("data", onData);
      nodeStream.on("end", onEnd);
      nodeStream.on("error", onError);
    },
    pull() {
      nodeStream.resume();
    },
    cancel() {
      destroy();
    },
  });
}
