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
export interface Detection {
  corners: Quad | null;
  aligned: boolean;
  alignment: number;
  sharpness: number;
  brightness: number;
  signature: number[];
}
export type AutoScanState =
  | 'searching'
  | 'detected'
  | 'stabilizing'
  | 'capturing'
  | 'captured'
  | 'waitingForPageChange'
  | 'paused'
  | 'finishing'
  | 'error';
export interface ProcessedImage {
  blob: Blob;
  fingerprint: number[];
  width: number;
  height: number;
}
export type VisionRequest =
  | { id: number; type: 'analyze'; bitmap: ImageBitmap }
  | { id: number; type: 'process'; bitmap: ImageBitmap; corners: Quad | null };
export type VisionResponse = {
  id: number;
  result?: Detection | ProcessedImage;
  error?: string;
};
