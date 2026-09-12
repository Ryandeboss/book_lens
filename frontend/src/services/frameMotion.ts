import { scannerConfig as config } from '../config/scanner';
import type { Quad } from '../types/scanner';

// Subtract average exposure, but do not amplify sensor noise on a blank page.
export function motionDifference(a: ArrayLike<number>, b: ArrayLike<number>) {
  if (!a.length || a.length !== b.length) return 1;
  let exposure = 0;
  for (let i = 0; i < a.length; i++) exposure += a[i]! - b[i]!;
  exposure /= a.length;
  let difference = 0;
  for (let i = 0; i < a.length; i++)
    difference += Math.abs(a[i]! - b[i]! - exposure);
  return difference / a.length / 255;
}

export class FrameMotion {
  previous: Uint8Array | null = null;
  roi: Quad | null = null;
  dimensions = '';
  sample(gray: Uint8Array, dimensions: string) {
    const difference =
      this.previous && this.dimensions === dimensions
        ? motionDifference(gray, this.previous)
        : 1;
    this.previous = new Uint8Array(gray);
    this.dimensions = dimensions;
    return { difference, moving: difference > config.motionDifference };
  }
}
