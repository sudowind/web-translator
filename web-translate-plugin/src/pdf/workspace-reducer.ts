export type LifecyclePhase =
  | 'idle'
  | 'loading-pdf'
  | 'awaiting-consent'
  | 'uploading'
  | 'parsing'
  | 'translating'
  | 'ready'
  | 'failed';

export interface LifecycleState {
  phase: LifecyclePhase;
  pdfReady: boolean;
  error?: string;
}

export type LifecycleAction =
  | { type: 'load-started' }
  | { type: 'source-loaded'; sourceKind: 'remote' | 'authenticated' }
  | { type: 'consent-granted' }
  | { type: 'parse-started' }
  | { type: 'parse-done' }
  | { type: 'translations-done' }
  | { type: 'parse-failed'; error: string }
  | { type: 'cancelled' }
  | { type: 'cache-cleared' };

export const initialLifecycleState: LifecycleState = {
  phase: 'idle',
  pdfReady: false,
};

export function lifecycleReducer(
  state: LifecycleState,
  action: LifecycleAction,
): LifecycleState {
  switch (action.type) {
    case 'load-started':
      return { ...state, phase: 'loading-pdf', error: undefined };
    case 'source-loaded':
      return {
        phase: action.sourceKind === 'authenticated' ? 'awaiting-consent' : 'parsing',
        pdfReady: true,
      };
    case 'consent-granted':
      return { ...state, phase: 'uploading', error: undefined };
    case 'parse-started':
      return { ...state, phase: 'parsing', error: undefined };
    case 'parse-done':
      return { ...state, phase: 'translating', error: undefined };
    case 'translations-done':
      return { ...state, phase: 'ready', error: undefined };
    case 'parse-failed':
      return { ...state, phase: 'failed', error: action.error };
    case 'cancelled':
      return { ...state, phase: 'idle', error: undefined };
    case 'cache-cleared':
      return initialLifecycleState;
  }
}
