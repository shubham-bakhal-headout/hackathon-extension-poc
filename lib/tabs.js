/** Thin promise-friendly helpers over the chrome.tabs API. */

const DEFAULT_LOAD_TIMEOUT_MS = 30_000;

export function createTab(url) {
  return chrome.tabs.create({ url });
}

/**
 * Resolve once the tab finishes loading (status "complete"), or after a timeout.
 * Checks the current status first so we don't miss an already-fired event.
 *
 * @returns {Promise<boolean>} true if it completed, false on timeout.
 */
export function waitForTabLoad(tabId, timeoutMs = DEFAULT_LOAD_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const finish = (value) => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve(value);
    };
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === "complete") finish(true);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab?.status === "complete") finish(true);
      })
      .catch(() => {});
  });
}
