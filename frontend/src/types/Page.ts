import type { PageFingerprint } from './scanner';
export type OcrProvider = 'google-document-ai' | 'tesseract';
export interface OcrParagraph {
  text: string;
  confidence?: number;
}
export interface CloudOcrResult {
  provider: 'google-document-ai';
  text: string;
  paragraphs: OcrParagraph[];
  detectedLanguages: string[];
}
export interface ScannedPage {
  id: string;
  pageNumber: number;
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
  confidence?: number;
  ocrProvider?: OcrProvider;
  paragraphs?: OcrParagraph[];
  detectedLanguages?: string[];
}
