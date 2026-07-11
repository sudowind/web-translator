export type PdfTargetKind = 'arxiv' | 'remote' | 'authenticated' | 'local';

export type ProbeFailureCode =
  | 'not_pdf'
  | 'permission_denied'
  | 'script_injection_blocked'
  | 'renderer_unverified'
  | 'url_changed'
  | 'bytes_unreadable'
  | 'restore_failed';

export interface PdfDetectionInput {
  url: string;
  contentType?: string;
}

export interface TakeoverProbeResult {
  tabId: number;
  originalUrl: string;
  finalUrl: string;
  kind?: PdfTargetKind;
  injected: boolean;
  rendererVerified: boolean;
  bytesReadable: boolean;
  restored: boolean;
  passed: boolean;
  failure?: ProbeFailureCode;
  detail?: string;
  measuredAt: string;
}
