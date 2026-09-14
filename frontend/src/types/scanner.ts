export interface Point {
  x: number;
  y: number;
}
export type Quad = [Point, Point, Point, Point]; // TL, TR, BR, BL, normalized.
export interface Guide {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface VisualSignature {
  gray: number[];
  hash: string; // 64-bit difference hash, hex encoded.
  edges: number[];
  density: number[];
}
export interface PageFingerprint extends VisualSignature {
  features?: { points: Point[]; descriptors: Uint8Array };
}
export interface RecentPage {
  id: string;
  pageNumber: number;
  fingerprint: PageFingerprint;
}
export interface DuplicateMatch {
  id: string;
  pageNumber: number;
  duplicate: boolean;
  gray: number;
  hash: number;
  edges: number;
  density: number;
  featureScore: number | null;
}
export interface Detection {
  gate?: 'motion' | 'page' | 'lighting' | 'sharpness' | 'text' | 'ready';
  motionDifference?: number;
  coverage?: number;
  textPresent?: boolean;
  analysisWidth?: number;
  analysisHeight?: number;
  source?: 'page' | 'text' | 'guide';
  captureCorners?: Quad;
  corners: Quad | null;
  aligned: boolean;
  alignment: number;
  sharpness: number;
  brightness: number;
  signature: number[];
  content?: VisualSignature;
  textBody?: Quad | null;
  confidence?: number;
  approximate?: boolean;
  hint?:
    'moveCloser' | 'fitPage' | 'centerOnePage' | 'textRequired' | 'clippedText';
}
export type AutoScanState =
  | 'searching'
  | 'detected'
  | 'stabilizing'
  | 'capturing'
  | 'captured'
  | 'cooldown'
  | 'waitingForPageChange'
  | 'duplicate'
  | 'paused'
  | 'finishing'
  | 'error';
export interface ProcessedImage {
  blob: Blob;
  fingerprint: number[];
  visualFingerprint?: PageFingerprint;
  duplicateMatch?: DuplicateMatch | null;
  width: number;
  height: number;
}
export interface PixelFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
export type VisionFrame = ImageBitmap | PixelFrame;
export type RawProcessedImage = Omit<ProcessedImage, 'blob'> & {
  pixels: PixelFrame;
};
export type VisionRequest =
  | { id: number; type: 'analyze'; bitmap: VisionFrame; still?: boolean }
  | {
      id: number;
      type: 'process';
      bitmap: VisionFrame;
      corners: Quad | null;
      recent?: RecentPage[];
      textBody?: Quad | null;
    };
export type VisionResponse = {
  id: number;
  result?: Detection | ProcessedImage | RawProcessedImage;
  error?: string;
  errorStage?: 'initialization' | 'analysis' | 'processing';
};
