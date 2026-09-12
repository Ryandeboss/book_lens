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
  hint?: 'moveCloser' | 'fitPage' | 'centerOnePage';
}
export type AutoScanState =
  | 'searching'
  | 'detected'
  | 'stabilizing'
  | 'capturing'
  | 'captured'
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
export type VisionRequest =
  | { id: number; type: 'analyze'; bitmap: ImageBitmap }
  | {
      id: number;
      type: 'process';
      bitmap: ImageBitmap;
      corners: Quad | null;
      recent?: RecentPage[];
    };
export type VisionResponse = {
  id: number;
  result?: Detection | ProcessedImage;
  error?: string;
};
