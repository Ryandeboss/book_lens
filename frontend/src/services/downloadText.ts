export function downloadText(text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'booklens-scan.txt';
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Give Safari time to begin consuming the download before releasing the URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
