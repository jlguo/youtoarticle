export interface AppState {
  sessionId: string | null;
  isGenerating: boolean;
  isFromFallback: boolean;
  renderScheduled: boolean;
  rafId: number;
  abortController: AbortController | null;
  fullArticleText: string;
  renderedLen: number;
  fontSize: number;
  hasReceivedFirstData: boolean;
  copyTimeout: ReturnType<typeof setTimeout> | null;
  tocScrollTracking: boolean;
  isAdvancedOpen: boolean;
}

export const state: AppState = {
  sessionId: null,
  isGenerating: false,
  isFromFallback: false,
  renderScheduled: false,
  rafId: 0,
  abortController: null,
  fullArticleText: '',
  renderedLen: 0,
  fontSize: 100,
  hasReceivedFirstData: false,
  copyTimeout: null,
  tocScrollTracking: false,
  isAdvancedOpen: false,
};
