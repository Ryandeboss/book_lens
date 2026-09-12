import type * as CV from '@techstark/opencv-js';
import { scannerConfig as config } from '../config/scanner';
import type {
  Detection,
  Quad,
  ProcessedImage,
  RecentPage,
  PageFingerprint,
} from '../types/scanner';
import {
  alignmentFor,
  guideForFrame,
  guideCorners,
  orderCorners,
  outputSize,
  polygonArea,
} from './scannerGeometry';
import { visualSignature, findRecentDuplicate } from './pageFingerprint';
import { estimateTextBody, canCaptureTextBody } from './textBody';
type OpenCv = typeof CV;

function signature(cv: OpenCv, gray: CV.Mat) {
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
    return visualSignature(Array.from(small.data), small.cols, small.rows);
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
    let approximate = false,
      wide = false;
    const candidates: { quad: Quad; score: number }[] = [];
    let best: Quad | null = null,
      bestScore = 0;
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i),
        approx = new cv.Mat(),
        hull = new cv.Mat();
      try {
        const area = cv.contourArea(contour) / (src.cols * src.rows);
        if (area < config.minPageArea) continue;
        cv.approxPolyDP(
          contour,
          approx,
          config.contourEpsilon * cv.arcLength(contour, true),
          true,
        );
        let relaxed = false;
        if (approx.rows !== 4 || !cv.isContourConvex(approx)) {
          cv.convexHull(contour, hull);
          cv.approxPolyDP(
            hull,
            approx,
            config.contourRelaxedEpsilon * cv.arcLength(hull, true),
            true,
          );
          relaxed = true;
        }
        if (approx.rows !== 4 || !cv.isContourConvex(approx)) continue;
        const p = orderCorners(
          Array.from({ length: 4 }, (_, j) => ({
            x: approx.data32S[j * 2]! / src.cols,
            y: approx.data32S[j * 2 + 1]! / src.rows,
          })),
        );
        const size = outputSize(p, src.cols, src.rows),
          aspect = size.width / size.height;
        if (aspect > config.singlePageMaxAspect) {
          wide = true;
          continue;
        }
        if (aspect < config.minAspect) continue;
        const a = alignmentFor(p, guide);
        const score = polygonArea(p) * (a.score + 0.2) * (relaxed ? 0.95 : 1);
        candidates.push({ quad: p, score });
        if (score > bestScore) {
          best = p;
          approximate = relaxed;
          bestScore = score;
        }
      } finally {
        hull.delete();
        approx.delete();
        contour.delete();
      }
    }
    // Distinct, similarly ranked page candidates are ambiguous; nested contours are not.
    const center = (q: Quad) => ({
      x: q.reduce((n, p) => n + p.x, 0) / 4,
      y: q.reduce((n, p) => n + p.y, 0) / 4,
    });
    const ambiguous =
      best &&
      candidates.some(
        (c) =>
          c.score >= bestScore * (1 - config.candidateAmbiguity) &&
          Math.hypot(
            center(c.quad).x - center(best!).x,
            center(c.quad).y - center(best!).y,
          ) > 0.18,
      );
    if (ambiguous) best = null;
    // If the paper edge is incomplete/misaligned, inspect the guide for printed
    // text instead. Use the guide crop, never invent perspective corners.
    const boundaryAligned = best ? alignmentFor(best, guide).aligned : false;
    const bounds = boundaryAligned ? best! : guideCorners(guide);
    const size = outputSize(bounds, src.cols, src.rows);
    const scale = Math.min(
      1,
      config.textPreviewMaxEdge / Math.max(size.width, size.height),
    );
    const w = Math.max(32, Math.round(size.width * scale)),
      h = Math.max(32, Math.round(size.height * scale));
    const from = own(
      cv.matFromArray(
        4,
        1,
        cv.CV_32FC2,
        bounds.flatMap((p) => [p.x * src.cols, p.y * src.rows]),
      ),
    );
    const to = own(
      cv.matFromArray(4, 1, cv.CV_32FC2, [
        0,
        0,
        w - 1,
        0,
        w - 1,
        h - 1,
        0,
        h - 1,
      ]),
    );
    const transform = own(cv.getPerspectiveTransform(from, to)),
      inverse = own(cv.getPerspectiveTransform(to, from));
    const page = own(new cv.Mat());
    cv.warpPerspective(
      gray,
      page,
      transform,
      new cv.Size(w, h),
      cv.INTER_LINEAR,
      cv.BORDER_REPLICATE,
    );
    const roi = own(
      page.roi(
        new cv.Rect(
          Math.floor(w * 0.03),
          Math.floor(h * 0.03),
          Math.floor(w * 0.94),
          Math.floor(h * 0.94),
        ),
      ),
    );
    const lap = own(new cv.Mat()),
      mean = own(new cv.Mat()),
      deviation = own(new cv.Mat());
    cv.Laplacian(roi, lap, cv.CV_64F);
    cv.meanStdDev(lap, mean, deviation);
    const sharpness = deviation.data64F[0]! ** 2;
    const binary = own(new cv.Mat()),
      joined = own(new cv.Mat());
    cv.adaptiveThreshold(
      page,
      binary,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY_INV,
      config.textThresholdBlock,
      config.textThresholdOffset,
    );
    const kernel = own(
      cv.getStructuringElement(
        cv.MORPH_RECT,
        new cv.Size(config.textLineKernelWidth, 1),
      ),
    );
    cv.morphologyEx(binary, joined, cv.MORPH_CLOSE, kernel);
    const lines = own(new cv.MatVector()),
      lineHierarchy = own(new cv.Mat());
    cv.findContours(
      joined,
      lines,
      lineHierarchy,
      cv.RETR_EXTERNAL,
      cv.CHAIN_APPROX_SIMPLE,
    );
    const boxes = [];
    for (let i = 0; i < lines.size(); i++) {
      const line = lines.get(i);
      try {
        const r = cv.boundingRect(line);
        boxes.push({
          x: r.x / w,
          y: r.y / h,
          width: r.width / w,
          height: r.height / h,
        });
      } finally {
        line.delete();
      }
    }
    const body = estimateTextBody(boxes);
    const textCapture =
      !boundaryAligned &&
      !ambiguous &&
      !wide &&
      canCaptureTextBody(boxes, body);
    const matrix = inverse.data64F;
    const project = (x: number, y: number) => {
      const X = x * (w - 1),
        Y = y * (h - 1),
        z = matrix[6]! * X + matrix[7]! * Y + matrix[8]!;
      return {
        x: (matrix[0]! * X + matrix[1]! * Y + matrix[2]!) / z / src.cols,
        y: (matrix[3]! * X + matrix[4]! * Y + matrix[5]!) / z / src.rows,
      };
    };
    const textBody: Quad | null = body
      ? [
          project(body.x, body.y),
          project(body.x + body.width, body.y),
          project(body.x + body.width, body.y + body.height),
          project(body.x, body.y + body.height),
        ]
      : null;
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
      source: textCapture ? 'text' : 'page',
      corners: textCapture ? null : best,
      aligned: alignment.aligned || textCapture,
      alignment: alignment.score,
      sharpness,
      brightness: cv.mean(roi)[0]!,
      signature: signature(cv, guideRoi).gray,
      content: boundaryAligned || textCapture ? signature(cv, page) : undefined,
      textBody,
      approximate,
      confidence: alignment.score,
      hint:
        ambiguous || (!best && wide)
          ? 'centerOnePage'
          : best &&
              polygonArea(best) <
                guide.width * guide.height * config.minGuideCoverage
            ? 'moveCloser'
            : 'fitPage',
    };
  } finally {
    owned.reverse().forEach((m) => m.delete());
  }
}
export async function preparePage(
  cv: OpenCv,
  bitmap: ImageBitmap,
  corners: Quad | null,
  recent: RecentPage[] = [],
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
    const visualFingerprint: PageFingerprint = signature(cv, gray);
    if (config.orbEnabled && typeof cv.ORB === 'function') {
      try {
        const featureGray = own(new cv.Mat()),
          mask = own(new cv.Mat()),
          descriptors = own(new cv.Mat()),
          points = own(new cv.KeyPointVector());
        const orb = own(new cv.ORB());
        const scale = Math.min(
          1,
          config.orbMaxEdge / Math.max(gray.cols, gray.rows),
        );
        cv.resize(
          gray,
          featureGray,
          new cv.Size(
            Math.round(gray.cols * scale),
            Math.round(gray.rows * scale),
          ),
          0,
          0,
          cv.INTER_AREA,
        );
        (
          orb as CV.ORB & { setMaxFeatures(count: number): void }
        ).setMaxFeatures(config.orbMaxFeatures);
        orb.detectAndCompute(featureGray, mask, points, descriptors);
        if (descriptors.cols === 32)
          visualFingerprint.features = {
            points: Array.from({ length: points.size() }, (_, i) => {
              const p = points.get(i).pt;
              return { x: p.x / featureGray.cols, y: p.y / featureGray.rows };
            }),
            descriptors: new Uint8Array(descriptors.data),
          };
      } catch {
        /* Optional features must never stop scanning. */
      }
    }
    const duplicateMatch = findRecentDuplicate(visualFingerprint, recent);
    const fingerprint = visualFingerprint.gray;
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
    return { blob, fingerprint, visualFingerprint, duplicateMatch, ...size };
  } finally {
    owned.reverse().forEach((m) => m.delete());
  }
}
