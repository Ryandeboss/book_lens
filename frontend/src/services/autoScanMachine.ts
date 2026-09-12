import { scannerConfig as config } from '../config/scanner';
import { polygonArea, cornerDistance } from './scannerGeometry';
import { signatureDifference, contentChanged } from './pageFingerprint';
import type {
  AutoScanState,
  Detection,
  Quad,
  VisualSignature,
} from '../types/scanner';

export class AutoScanMachine {
  state: AutoScanState = 'searching';
  message = 'Point the camera at a block of text';
  changeScore = 0;
  stableProgress = 0;
  private bodyAnchor: Quad | null = null;
  private lockedSource: Detection['source'];
  private lockedContent: VisualSignature | undefined;
  private duplicateAt = -Infinity;
  duplicateNotifications = 0;
  private anchor: Quad | null = null;
  private previousGeometry: Quad | null = null;
  private stableSignature: number[] = [];
  private stableSince = 0;
  stableSamples = 0;
  stableDuration = 0;
  private lastSample = 0;
  private lockedSignature: number[] | null = null;
  private changeSamples = 0;
  private flashUntil = 0;

  resetStability() {
    this.anchor = null;
    this.previousGeometry = null;
    this.stableSamples = 0;
    this.stableProgress = 0;
    this.stableDuration = 0;
  }
  pause(message = 'Scanner paused') {
    this.resetStability();
    this.state = 'paused';
    this.message = message;
  }
  finish() {
    this.resetStability();
    this.state = 'finishing';
    this.message = 'Finishing scan...';
  }
  fail(message: string) {
    this.resetStability();
    this.state = 'error';
    this.message = message;
  }
  accepted(
    signature: number[],
    now: number,
    label: string,
    content?: VisualSignature,
    source?: Detection['source'],
  ) {
    this.lockedSource = source;
    this.lockedContent = content;
    this.lockedSignature = [...signature];
    this.changeSamples = 0;
    this.flashUntil = now + config.flashMs;
    this.state = 'captured';
    this.message = label;
    this.resetStability();
  }
  endFlash(now: number) {
    if (this.state === 'captured' && now >= this.flashUntil) {
      this.state = 'waitingForPageChange';
      this.message = 'Turn to the next page';
    }
  }
  duplicate(
    signature: number[],
    now = performance.now(),
    content?: VisualSignature,
    source?: Detection['source'],
  ) {
    this.lockedSource = source;
    this.lockedSignature = [...signature];
    this.lockedContent = content;
    this.changeSamples = 0;
    this.state = 'duplicate';
    this.message = 'Already scanned. Turn to the next page.';
    if (now - this.duplicateAt >= config.duplicateMessageCooldownMs) {
      this.duplicateAt = now;
      this.duplicateNotifications++;
    }
    this.resetStability();
  }
  sample(d: Detection, now: number, blocked = false): boolean {
    if (
      this.state === 'finishing' ||
      this.state === 'capturing' ||
      this.state === 'error'
    )
      return false;
    const flashing = this.state === 'captured' && now < this.flashUntil;
    if (now - this.lastSample > config.maxSampleGapMs) {
      this.resetStability();
      this.changeSamples = 0;
    }
    this.lastSample = now;
    // Observe turns even during the green flash or OCR backpressure. Otherwise
    // an immediate turn to a similar-looking page can be missed entirely.
    if (this.lockedSignature) {
      const content =
        this.lockedContent && d.content && this.lockedSource === d.source
          ? contentChanged(d.content, this.lockedContent)
          : null;
      this.changeScore = content
        ? content.score
        : signatureDifference(d.signature, this.lockedSignature);
      const changed = content
        ? content.changed
        : this.changeScore >= config.pageChangeDifference;
      this.changeSamples = changed ? this.changeSamples + 1 : 0;
      if (this.changeSamples >= config.pageChangeSamples) {
        this.lockedSignature = null;
        this.resetStability();
      }
    }
    if (flashing) return false;
    if (blocked) {
      this.pause('Processing pages... Hold for a moment.');
      return false;
    }
    if (this.lockedSignature) {
      if (this.state === 'duplicate') return false;
      if (this.state !== 'waitingForPageChange')
        this.message = 'Turn to the next page';
      this.state = 'waitingForPageChange';
      return false;
    }
    if (d.gate === 'motion') {
      this.state = 'detected';
      this.message = 'Hold steady';
      this.resetStability();
      return false;
    }
    if (d.gate === 'lighting' || d.gate === 'sharpness') {
      this.state = 'detected';
      this.message =
        d.gate === 'lighting'
          ? 'More light needed'
          : 'Image too blurry. Hold steady.';
      this.resetStability();
      return false;
    }
    const geometry = d.corners ?? (d.source === 'text' ? d.textBody : null);
    if (!geometry) {
      this.state = 'searching';
      this.message =
        d.hint === 'centerOnePage'
          ? 'Center one page in the frame'
          : 'Point the camera at a block of text';
      this.resetStability();
      return false;
    }
    if (d.brightness < config.minBrightness) {
      this.state = 'detected';
      this.message = 'More light needed';
      this.resetStability();
      return false;
    }
    if (d.sharpness < config.minSharpness) {
      this.state = 'detected';
      this.message = 'Image too blurry. Hold steady.';
      this.resetStability();
      return false;
    }
    if (!d.aligned) {
      this.state = 'detected';
      this.message =
        d.hint === 'moveCloser'
          ? 'Move closer to the page'
          : d.hint === 'clearMargin'
            ? 'Leave a clear margin around the text'
            : 'Fit the page inside the frame';
      this.resetStability();
      return false;
    }
    const center = (q: Quad) => ({
      x: q.reduce((n, p) => n + p.x, 0) / 4,
      y: q.reduce((n, p) => n + p.y, 0) / 4,
    });
    const previous = this.previousGeometry;
    const moving =
      d.source === 'text' &&
      previous &&
      Math.hypot(
        center(geometry).x - center(previous).x,
        center(geometry).y - center(previous).y,
      ) > config.textCenterMovement;
    this.previousGeometry = geometry;
    this.state = 'stabilizing';
    this.message = 'Hold steady - scanning automatically...';
    if (
      moving ||
      !this.anchor ||
      cornerDistance(geometry, this.anchor) >
        (d.source === 'text'
          ? config.textBodyMovement
          : config.cornerMovement) ||
      Math.abs(polygonArea(geometry) - polygonArea(this.anchor)) /
        Math.max(0.001, polygonArea(this.anchor)) >
        config.pageAreaMovement ||
      (d.textBody &&
        this.bodyAnchor &&
        cornerDistance(d.textBody, this.bodyAnchor) >
          config.textBodyMovement) ||
      (d.source !== 'text' &&
        signatureDifference(
          d.content?.gray ?? d.signature,
          this.stableSignature,
        ) > config.stableVisualDifference)
    ) {
      this.anchor = geometry;
      this.bodyAnchor = d.textBody ?? null;
      this.stableSignature = d.content?.gray ?? d.signature;
      this.stableSamples = 1;
      this.stableSince = now;
      this.stableProgress = 0;
      this.stableDuration = 0;
      return false;
    }
    this.stableSamples++;
    this.stableDuration = now - this.stableSince;
    this.stableProgress = Math.min(
      1,
      this.stableSamples / config.stabilityMinSamples,
      (now - this.stableSince) / config.stabilityMs,
    );
    if (this.stableProgress < 1) return false;
    this.state = 'capturing';
    this.message = 'Scanning page... Keep still';
    return true;
  }
}
