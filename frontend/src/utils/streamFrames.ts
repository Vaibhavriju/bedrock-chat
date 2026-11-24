/** API Gateway limits UTF-8 bytes per frame, including the JSON envelope. */
export function makeStreamFrames(
  payload: string,
  step: string,
  maxBytes = 30 * 1024
) {
  if (maxBytes < 128) {
    throw new Error('Frame budget is too small');
  }
  const encoder = new TextEncoder();
  const frames: string[] = [];
  let offset = 0;
  while (offset < payload.length) {
    let low = offset + 1;
    let high = Math.min(payload.length, offset + maxBytes);
    let best = offset;
    while (low <= high) {
      const end = Math.floor((low + high) / 2);
      const frame = JSON.stringify({
        step,
        index: frames.length,
        part: payload.slice(offset, end),
      });
      if (encoder.encode(frame).byteLength <= maxBytes) {
        best = end;
        low = end + 1;
      } else {
        high = end - 1;
      }
    }
    if (best === offset) {
      throw new Error('Payload cannot fit in a frame');
    }
    // Keep a surrogate pair together when a frame ends in the middle of one.
    const code = payload.charCodeAt(best - 1);
    if (best < payload.length && code >= 0xd800 && code <= 0xdbff) {
      best--;
    }
    if (best === offset) {
      throw new Error('Payload cannot fit in a frame');
    }
    frames.push(
      JSON.stringify({
        step,
        index: frames.length,
        part: payload.slice(offset, best),
      })
    );
    offset = best;
  }
  return frames;
}
