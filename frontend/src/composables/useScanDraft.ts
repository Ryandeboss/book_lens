import { inject, type InjectionKey } from 'vue';
import type { createScanDraft } from '../services/scanDraft';
export const scanDraftKey: InjectionKey<ReturnType<typeof createScanDraft>> =
  Symbol('scan-draft');
export const useScanDraft = () => inject(scanDraftKey, null);
