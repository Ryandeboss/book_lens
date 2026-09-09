export interface ScannedPage {
  id: string;
  pageNumber: number;
  rawText: string;
  editedText: string;
  confidence?: number;
}
export interface OcrResult {
  rawText: string;
  confidence?: number;
}
