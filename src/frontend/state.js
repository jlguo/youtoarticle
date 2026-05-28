export const state = {
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
  isAdvancedOpen: false
};
