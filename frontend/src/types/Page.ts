import type { PageFingerprint } from './scanner';
export type OcrProvider = 'google-document-ai' | 'tesseract';
export interface OcrParagraph {
  text: string;
  confidence?: number;
}
export interface CloudOcrResult {
  provider: 'google-document-ai';
  confidence?: number; // 0–100, derived from complete token coverage.
  confidenceMethod?: 'token-character-weighted';
  text: string;
  paragraphs: OcrParagraph[];
  detectedLanguages: string[];
}
export interface ScannedPage {
  id: string;
  pageNumber: number;
  capturePosition?: number;
  correctedText?: string;
  cleanupStatus?:
    'applied' | 'unavailable' | 'failed' | 'disabled' | 'processing';
  cleanupError?: string;
  duplicateOf?: string;
  duplicateScore?: number;
  keepDuplicate?: boolean;
  rawText: string;
  editedText: string;
  confidence?: number;
  ocrProvider?: OcrProvider;
  paragraphs?: OcrParagraph[];
  detectedLanguages?: string[];
  status: 'queued' | 'processing' | 'ready' | 'error';
  fingerprint?: number[];
  visualFingerprint?: PageFingerprint;
  error?: string;
}
export interface OcrResult {
  rawText: string;
  correctedText?: string;
  cleanupStatus?: ScannedPage['cleanupStatus'];
  cleanupError?: string;
  confidence?: number;
  ocrProvider?: OcrProvider;
  paragraphs?: OcrParagraph[];
  detectedLanguages?: string[];
}
