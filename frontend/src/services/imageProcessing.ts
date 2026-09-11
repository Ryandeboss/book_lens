import type * as CV from '@techstark/opencv-js';
import { scannerConfig as config } from '../config/scanner';
import type { Detection, Quad, ProcessedImage } from '../types/scanner';
import {
  alignmentFor,
  guideForFrame,
  guideCorners,
  orderCorners,
  outputSize,
  polygonArea,
} from './scannerGeometry';
import { normalizeSignature } from './pageFingerprint';
type OpenCv = typeof CV;

function signature(cv: OpenCv, gray: CV.Mat): number[] {
  const small = new cv.Mat();
  try {
    cv.resize(
      gray,
      small,
      new cv.Size(config.fingerprintWidth, config.fingerprintHeight),
      0,
      0,
      cv.INTER_AREA,
    );
    return normalizeSignature(Array.from(small.data));
  } finally {
    small.delete();
  }
}
function pixels(bitmap: ImageBitmap) {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image canvas unavailable');
  context.drawImage(bitmap, 0, 0);
  return context.getImageData(0, 0, bitmap.width, bitmap.height);
}
export function analyzePage(cv: OpenCv, bitmap: ImageBitmap): Detection {
  const owned: { delete(): void }[] = [];
  const own = <T extends { delete(): void }>(value: T): T => {
    owned.push(value);
    return value;
  };
  try {
    const src = own(cv.matFromImageData(pixels(bitmap)));
    const gray = own(new cv.Mat()),
      blur = own(new cv.Mat()),
      edges = own(new cv.Mat());
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    cv.Canny(blur, edges, config.cannyLow, config.cannyHigh);
    const contours = own(new cv.MatVector()),
      hierarchy = own(new cv.Mat());
    cv.findContours(
      edges,
      contours,
      hierarchy,
      cv.RETR_LIST,
      cv.CHAIN_APPROX_SIMPLE,
    );
    const guide = guideForFrame(src.cols, src.rows);
    let best: Quad | null = null,
      bestScore = 0;
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i),
        approx = new cv.Mat();
      try {
        const area = cv.contourArea(contour) / (src.cols * src.rows);
        if (area < config.minPageArea) continue;
        cv.approxPolyDP(
          contour,
          approx,
          config.contourEpsilon * cv.arcLength(contour, true),
          true,
        );
        if (approx.rows !== 4 || !cv.isContourConvex(approx)) continue;
        const p = orderCorners(
          Array.from({ length: 4 }, (_, j) => ({
            x: approx.data32S[j * 2]! / src.cols,
            y: approx.data32S[j * 2 + 1]! / src.rows,
          })),
        );
        const size = outputSize(p, src.cols, src.rows),
          aspect = size.width / size.height;
        if (aspect < config.minAspect || aspect > config.maxAspect) continue;
        const a = alignmentFor(p, guide);
        const score = polygonArea(p) * (a.score + 0.2);
        if (score > bestScore) {
          best = p;
          bestScore = score;
        }
      } finally {
        approx.delete();
        contour.delete();
      }
    }
    // Measure quality inside the page, away from the high-contrast outer border.
    const bounds = best ?? guideCorners(guide);
    const xs = bounds.map((p) => p.x),
      ys = bounds.map((p) => p.y);
    const x = Math.max(
      0,
      Math.floor(
        (Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * 0.12) *
          src.cols,
      ),
    );
    const y = Math.max(
      0,
      Math.floor(
        (Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * 0.12) *
          src.rows,
      ),
    );
    const width = Math.max(
      1,
      Math.min(
        src.cols - x,
        Math.floor((Math.max(...xs) - Math.min(...xs)) * src.cols * 0.76),
      ),
    );
    const height = Math.max(
      1,
      Math.min(
        src.rows - y,
        Math.floor((Math.max(...ys) - Math.min(...ys)) * src.rows * 0.76),
      ),
    );
    const roi = own(gray.roi(new cv.Rect(x, y, width, height))),
      lap = own(new cv.Mat()),
      mean = own(new cv.Mat()),
      deviation = own(new cv.Mat());
    cv.Laplacian(roi, lap, cv.CV_64F);
    cv.meanStdDev(lap, mean, deviation);
    const sharpness = deviation.data64F[0]! ** 2;
    const guideRoi = own(
      gray.roi(
        new cv.Rect(
          Math.floor(guide.x * src.cols),
          Math.floor(guide.y * src.rows),
          Math.max(1, Math.floor(guide.width * src.cols)),
          Math.max(1, Math.floor(guide.height * src.rows)),
        ),
      ),
    );
    const alignment = best
      ? alignmentFor(best, guide)
      : { aligned: false, score: 0 };
    return {
      corners: best,
      aligned: alignment.aligned,
      alignment: alignment.score,
      sharpness,
      brightness: cv.mean(roi)[0]!,
      signature: signature(cv, guideRoi),
    };
  } finally {
    owned.reverse().forEach((m) => m.delete());
  }
}
export async function preparePage(
  cv: OpenCv,
  bitmap: ImageBitmap,
  corners: Quad | null,
): Promise<ProcessedImage> {
  const owned: { delete(): void }[] = [];
  const own = <T extends { delete(): void }>(value: T): T => {
    owned.push(value);
    return value;
  };
  try {
    const src = own(cv.matFromImageData(pixels(bitmap)));
    const quad = corners ?? guideCorners(guideForFrame(src.cols, src.rows));
    const size = outputSize(quad, src.cols, src.rows);
    const from = own(
      cv.matFromArray(
        4,
        1,
        cv.CV_32FC2,
        quad.flatMap((p) => [p.x * src.cols, p.y * src.rows]),
      ),
    );
    const to = own(
      cv.matFromArray(4, 1, cv.CV_32FC2, [
        0,
        0,
        size.width - 1,
        0,
        size.width - 1,
        size.height - 1,
        0,
        size.height - 1,
      ]),
    );
    const transform = own(cv.getPerspectiveTransform(from, to)),
      corrected = own(new cv.Mat()),
      gray = own(new cv.Mat()),
      normalized = own(new cv.Mat()),
      rgba = own(new cv.Mat());
    cv.warpPerspective(
      src,
      corrected,
      transform,
      new cv.Size(size.width, size.height),
      cv.INTER_LINEAR,
      cv.BORDER_REPLICATE,
    );
    cv.cvtColor(corrected, gray, cv.COLOR_RGBA2GRAY);
    const fingerprint = signature(cv, gray);
    // Conservative global contrast stretch; preserve antialiased strokes instead of hard thresholding.
    cv.normalize(gray, normalized, 0, 255, cv.NORM_MINMAX, cv.CV_8U);
    cv.cvtColor(normalized, rgba, cv.COLOR_GRAY2RGBA);
    const canvas = new OffscreenCanvas(size.width, size.height),
      context = canvas.getContext('2d');
    if (!context) throw new Error('Image canvas unavailable');
    context.putImageData(
      new ImageData(new Uint8ClampedArray(rgba.data), size.width, size.height),
      0,
      0,
    );
    let blob = await canvas.convertToBlob({
      type: config.ocrImageType,
      quality: config.ocrJpegQuality,
    });
    if (config.ocrUseSmallerPng) {
      const png = await canvas.convertToBlob({ type: 'image/png' });
      if (png.size < blob.size) blob = png;
    }
    return { blob, fingerprint, ...size };
  } finally {
    owned.reverse().forEach((m) => m.delete());
  }
}
