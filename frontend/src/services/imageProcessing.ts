import type * as CV from '@techstark/opencv-js';
import { scannerConfig as config } from '../config/scanner';
import type {
  Detection,
  Quad,
  ProcessedImage,
  RecentPage,
  PageFingerprint,
  VisionFrame,
  RawProcessedImage,
} from '../types/scanner';
import {
  guideForFrame,
  guideCorners,
  outputSize,
  orderCorners,
  polygonArea,
  cornerDistance,
} from './scannerGeometry';
import { FrameMotion } from './frameMotion';
import { visualSignature, findRecentDuplicate } from './pageFingerprint';
import {
  estimateTextBody,
  canCaptureTextBody,
  hasPrintedStrokes,
} from './textBody';
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
function pixels(bitmap: VisionFrame) {
  if ('data' in bitmap) return bitmap;
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image canvas unavailable');
  context.drawImage(bitmap, 0, 0);
  return context.getImageData(0, 0, bitmap.width, bitmap.height);
}
export function analyzePage(
  cv: OpenCv,
  bitmap: VisionFrame,
  motion?: FrameMotion,
): Detection {
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
    const globalSignature = signature(cv, gray).gray;
    let motionDifference = 0;
    if (motion) {
      const small = own(new cv.Mat());
      // Sample the same source rectangle in consecutive frames. Changing the ROI
      // resets the baseline; small boundary jitter keeps the same sample region.
      let sample = gray;
      if (motion.roi && motion.dimensions === `${src.cols}x${src.rows}`) {
        const q = motion.roi;
        const x = Math.max(
          0,
          Math.floor(Math.min(...q.map((p) => p.x)) * src.cols),
        );
        const y = Math.max(
          0,
          Math.floor(Math.min(...q.map((p) => p.y)) * src.rows),
        );
        const w = Math.min(
          src.cols - x,
          Math.ceil(Math.max(...q.map((p) => p.x)) * src.cols) - x,
        );
        const h = Math.min(
          src.rows - y,
          Math.ceil(Math.max(...q.map((p) => p.y)) * src.rows) - y,
        );
        if (w > 8 && h > 8) sample = own(gray.roi(new cv.Rect(x, y, w, h)));
      }
      cv.resize(
        sample,
        small,
        new cv.Size(config.motionSize, config.motionSize),
        0,
        0,
        cv.INTER_AREA,
      );
      const result = motion.sample(small.data, `${src.cols}x${src.rows}`);
      motionDifference = result.difference;
      if (result.moving)
        return {
          corners: motion.roi,
          aligned: false,
          alignment: 0,
          sharpness: 0,
          brightness: 0,
          signature: globalSignature,
          gate: 'motion',
          motionDifference,
          analysisWidth: src.cols,
          analysisHeight: src.rows,
        };
    }
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
    let approximate = false;
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
        if (aspect > config.singlePageMaxAspect || aspect < config.minAspect)
          continue;
        const score = polygonArea(p) * (relaxed ? 0.95 : 1);
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
    // Page edges are useful for measuring focus, but margins and position
    // inside the guide never gate capture. Borderless pages use text presence.
    const bounds = best ?? guideCorners(guide);
    const fullFrame = guideCorners({ x: 0, y: 0, width: 1, height: 1 });
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
    const brightness = cv.mean(roi)[0]!;
    const base: Detection = {
      source: best ? 'page' : 'guide',
      corners: best ? fullFrame : null,
      captureCorners: fullFrame,
      aligned: false,
      alignment: best ? 1 : 0,
      sharpness,
      brightness,
      signature: globalSignature,
      motionDifference,
      coverage: best ? polygonArea(best) : 0,
      approximate,
      analysisWidth: src.cols,
      analysisHeight: src.rows,
      hint: 'textRequired',
    };
    // Without paper edges, sample the central page area rather than diluting
    // text motion with the blank background surrounding the book.
    const motionRegion = guideCorners(guide);
    if (
      motion &&
      (!motion.roi ||
        cornerDistance(motion.roi, motionRegion) > config.textBodyMovement)
    ) {
      motion.roi = motionRegion;
      motion.previous = null;
    }
    // Fail before thresholding/contours when light or focus cannot support OCR.
    if (brightness < config.minBrightness) return { ...base, gate: 'lighting' };
    if (sharpness < config.minSharpness) return { ...base, gate: 'sharpness' };
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
      cv.RETR_LIST,
      cv.CHAIN_APPROX_SIMPLE,
    );
    const boxes = [];
    for (let i = 0; i < lines.size(); i++) {
      const line = lines.get(i);
      try {
        const r = cv.boundingRect(line);
        if (
          r.width / w < config.textLineMinWidth ||
          r.height / h > config.textLineMaxHeight ||
          r.width / r.height < 3 ||
          !hasPrintedStrokes(binary.data, w, r)
        )
          continue;
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
    const textCapture = canCaptureTextBody(boxes, body);
    const m = inverse.data64F;
    const textBody: Quad | null = body
      ? (guideCorners(body).map((p) => {
          const x = p.x * (w - 1),
            y = p.y * (h - 1),
            z = m[6]! * x + m[7]! * y + m[8]!;
          return {
            x: (m[0]! * x + m[1]! * y + m[2]!) / z / src.cols,
            y: (m[3]! * x + m[4]! * y + m[5]!) / z / src.rows,
          };
        }) as Quad)
      : null;
    // An outline alone can be a leg, furniture or another focused object.
    // Require printed-line evidence already computed in this preview, without
    // adding an OCR call, extra hold time or any margin/line-end requirement.
    const aligned = textCapture;
    return {
      ...base,
      textBody,
      aligned,
      alignment: aligned ? 1 : base.alignment,
      textPresent: textCapture,
      content: signature(cv, roi),
      confidence: aligned ? 1 : 0,
      gate: aligned ? 'ready' : 'text',
    };
  } finally {
    owned.reverse().forEach((m) => m.delete());
  }
}
export async function preparePage(
  cv: OpenCv,
  bitmap: VisionFrame,
  corners: Quad | null,
  recent: RecentPage[] = [],
  textBody: Quad | null = null,
): Promise<ProcessedImage | RawProcessedImage> {
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
    let fingerprintImage = gray;
    if (textBody) {
      const m = transform.data64F;
      const mapped = textBody.map((p) => {
        const x = p.x * src.cols,
          y = p.y * src.rows,
          z = m[6]! * x + m[7]! * y + m[8]!;
        return {
          x: (m[0]! * x + m[1]! * y + m[2]!) / z,
          y: (m[3]! * x + m[4]! * y + m[5]!) / z,
        };
      });
      const left = Math.max(0, Math.floor(Math.min(...mapped.map((p) => p.x)))),
        top = Math.max(0, Math.floor(Math.min(...mapped.map((p) => p.y))));
      const right = Math.min(
          gray.cols,
          Math.ceil(Math.max(...mapped.map((p) => p.x))),
        ),
        bottom = Math.min(
          gray.rows,
          Math.ceil(Math.max(...mapped.map((p) => p.y))),
        );
      if (right - left > 8 && bottom - top > 8)
        fingerprintImage = own(
          gray.roi(new cv.Rect(left, top, right - left, bottom - top)),
        );
    }
    const visualFingerprint: PageFingerprint = signature(cv, fingerprintImage);
    if (config.orbEnabled && typeof cv.ORB === 'function') {
      try {
        const featureGray = own(new cv.Mat()),
          mask = own(new cv.Mat()),
          descriptors = own(new cv.Mat()),
          points = own(new cv.KeyPointVector());
        const orb = own(new cv.ORB());
        const scale = Math.min(
          1,
          config.orbMaxEdge /
            Math.max(fingerprintImage.cols, fingerprintImage.rows),
        );
        cv.resize(
          fingerprintImage,
          featureGray,
          new cv.Size(
            Math.round(fingerprintImage.cols * scale),
            Math.round(fingerprintImage.rows * scale),
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
    try {
      if (typeof OffscreenCanvas === 'undefined')
        throw new Error('Worker canvas unavailable');
      const canvas = new OffscreenCanvas(size.width, size.height),
        context = canvas.getContext('2d');
      if (!context) throw new Error('Image canvas unavailable');
      context.putImageData(
        new ImageData(
          new Uint8ClampedArray(rgba.data),
          size.width,
          size.height,
        ),
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
    } catch {
      // API presence does not guarantee a working 2D context or encoder.
      return {
        pixels: { data: new Uint8ClampedArray(rgba.data), ...size },
        fingerprint,
        visualFingerprint,
        duplicateMatch,
        ...size,
      };
    }
  } finally {
    owned.reverse().forEach((m) => m.delete());
  }
}
