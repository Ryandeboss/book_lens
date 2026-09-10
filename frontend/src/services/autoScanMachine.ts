import { scannerConfig as config } from '../config/scanner';
import { cornerDistance } from './scannerGeometry';
import { signatureDifference } from './pageFingerprint';
import type { AutoScanState, Detection, Quad } from '../types/scanner';

export class AutoScanMachine {
  state: AutoScanState = 'searching';
  message = 'Position page inside frame';
  changeScore = 0;
  stableProgress = 0;
  private anchor: Quad | null = null;
  private stableSignature: number[] = [];
  private stableSince = 0;
  private lastSample = 0;
  private lockedSignature: number[] | null = null;
  private changeSamples = 0;
  private flashUntil = 0;

  resetStability() {
    this.anchor = null;
    this.stableProgress = 0;
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
  accepted(signature: number[], now: number, label: string) {
    this.lockedSignature = [...signature];
    this.changeSamples = 0;
    this.flashUntil = now + config.flashMs;
    this.state = 'captured';
    this.message = label;
    this.resetStability();
  }
  duplicate(signature: number[]) {
    this.lockedSignature = [...signature];
    this.changeSamples = 0;
    this.state = 'waitingForPageChange';
    this.message = 'Duplicate page ignored. Turn to the next page.';
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
      this.changeScore = signatureDifference(d.signature, this.lockedSignature);
      this.changeSamples =
        this.changeScore >= config.pageChangeDifference
          ? this.changeSamples + 1
          : 0;
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
      if (this.state !== 'waitingForPageChange')
        this.message = 'Turn to the next page';
      this.state = 'waitingForPageChange';
      return false;
    }
    if (!d.corners) {
      this.state = 'searching';
      this.message = 'Position page inside frame';
      this.resetStability();
      return false;
    }
    if (!d.aligned) {
      this.state = 'detected';
      this.message = 'Align page';
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
    this.state = 'stabilizing';
    this.message = 'Hold steady...';
    if (
      !this.anchor ||
      cornerDistance(d.corners, this.anchor) > config.cornerMovement ||
      signatureDifference(d.signature, this.stableSignature) >
        config.stableVisualDifference
    ) {
      this.anchor = d.corners;
      this.stableSignature = d.signature;
      this.stableSince = now;
      this.stableProgress = 0;
      return false;
    }
    this.stableProgress = Math.min(
      1,
      (now - this.stableSince) / config.stabilityMs,
    );
    if (this.stableProgress < 1) return false;
    this.state = 'capturing';
    this.message = 'Capturing...';
    return true;
  }
}
