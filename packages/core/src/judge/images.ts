// SPDX-License-Identifier: GPL-3.0-or-later
// The API's limits for one image (docs/spec/judge.md#what-the-judge-sees): 2,576 px on the long
// edge and 4,784 visual tokens, counted in 28 px patches. A larger PNG is scaled down
// proportionally; story crops are well inside the limits.
import { PNG } from "pngjs";

export const maxLongEdge = 2576;
export const maxVisualTokens = 4784;
const patch = 28;

/** The visual tokens an image of this size costs. */
export function visualTokens(width: number, height: number): number {
  return Math.ceil(width / patch) * Math.ceil(height / patch);
}

/** The largest size within the limits with the image's proportions; the same size when it fits. */
export function fittedSize(width: number, height: number): { width: number; height: number } {
  if (Math.max(width, height) <= maxLongEdge && visualTokens(width, height) <= maxVisualTokens) {
    return { width, height };
  }
  let scale = Math.min(1, maxLongEdge / Math.max(width, height));
  for (;;) {
    const size = { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
    if (visualTokens(size.width, size.height) <= maxVisualTokens) return size;
    scale *= 0.98;
  }
}

/** The PNG scaled down to fit the limits, by averaging the source pixels each target pixel covers. */
export function fitPng(png: Buffer): Buffer {
  const source = PNG.sync.read(png);
  const size = fittedSize(source.width, source.height);
  if (size.width === source.width && size.height === source.height) return png;
  const target = new PNG({ width: size.width, height: size.height });
  const xRatio = source.width / size.width;
  const yRatio = source.height / size.height;
  for (let y = 0; y < size.height; y++) {
    const y0 = Math.floor(y * yRatio);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * yRatio));
    for (let x = 0; x < size.width; x++) {
      const x0 = Math.floor(x * xRatio);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * xRatio));
      const sum = [0, 0, 0, 0];
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const at = (sy * source.width + sx) * 4;
          for (let channel = 0; channel < 4; channel++)
            sum[channel] = (sum[channel] ?? 0) + (source.data[at + channel] ?? 0);
        }
      }
      const count = (y1 - y0) * (x1 - x0);
      const to = (y * size.width + x) * 4;
      for (let channel = 0; channel < 4; channel++) target.data[to + channel] = Math.round((sum[channel] ?? 0) / count);
    }
  }
  return PNG.sync.write(target);
}
