import { downloadBlob } from './downloadBlob';
export function downloadText(text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  downloadBlob(blob, 'booklens-scan.txt');
}
