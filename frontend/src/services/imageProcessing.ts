import type * as CV from '@techstark/opencv-js';
import { scannerConfig as config } from '../config/scanner';
import type {
  Detection,
  Quad,
  ProcessedImage,
  RecentPage,
  PageFingerprint,
} from '../types/scanner';
import { guideForFrame, guideCorners, outputSize } from './scannerGeometry';
import { visualSignature, findRecentDuplicate } from './pageFingerprint';
import {
  estimateTextBody,
  canCaptureTextBody,
  textMarginInk,
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
    // Text-first detection across the preview. Paper contours and the fixed
    // portrait guide do not participate in automatic acceptance.
    const gray = own(new cv.Mat());
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    const w = gray.cols,
      h = gray.rows;
    const page = gray;
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
    // Exclude enclosing paper/background contours from the whitespace test,
    // while retaining text and local illustrations/marks. Otherwise a tilted
    // paper edge crossing the axis-aligned text bounds looks like printed ink.
    const marginMask = own(cv.Mat.zeros(h, w, cv.CV_8UC1));
    const boxes = [];
    for (let i = 0; i < lines.size(); i++) {
      const line = lines.get(i);
      try {
        const r = cv.boundingRect(line);
        if (!(r.width > w * 0.4 && r.height > h * 0.4))
          cv.drawContours(marginMask, lines, i, new cv.Scalar(255), cv.FILLED);
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
    const marginInk = body ? textMarginInk(marginMask.data, w, h, body) : 1;
    const textCapture =
      canCaptureTextBody(boxes, body) && marginInk <= config.textMarginMaxInk;
    const textBody: Quad | null = body ? guideCorners(body) : null;
    const qualityBounds = body ?? { x: 0.05, y: 0.05, width: 0.9, height: 0.9 };
    const x = Math.max(0, Math.floor(qualityBounds.x * w)),
      y = Math.max(0, Math.floor(qualityBounds.y * h));
    const roi = own(
      gray.roi(
        new cv.Rect(
          x,
          y,
          Math.min(w - x, Math.max(1, Math.floor(qualityBounds.width * w))),
          Math.min(h - y, Math.max(1, Math.floor(qualityBounds.height * h))),
        ),
      ),
    );
    const lap = own(new cv.Mat()),
      mean = own(new cv.Mat()),
      deviation = own(new cv.Mat());
    cv.Laplacian(roi, lap, cv.CV_64F);
    cv.meanStdDev(lap, mean, deviation);
    return {
      source: 'text',
      corners: null,
      textBody,
      // Keep all visible text, headings and footnotes in the captured photograph.
      // The rectangle is the quality/feedback target, not a destructive text crop.
      captureCorners: guideCorners({ x: 0, y: 0, width: 1, height: 1 }),
      aligned: textCapture,
      alignment: textCapture ? 1 : 0,
      marginInk,
      sharpness: deviation.data64F[0]! ** 2,
      brightness: cv.mean(roi)[0]!,
      signature: signature(cv, gray).gray,
      content: body ? signature(cv, roi) : undefined,
      confidence: textCapture ? 1 : 0,
      hint: 'clearMargin',
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
  textBody: Quad | null = null,
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
