export interface ScannedPage {
  id: string;
  pageNumber: number;
  rawText: string;
  editedText: string;
  confidence?: number;
  status: 'queued' | 'processing' | 'ready' | 'error';
  fingerprint?: number[];
  error?: string;
}
export interface OcrResult {
  rawText: string;
  confidence?: number;
}
