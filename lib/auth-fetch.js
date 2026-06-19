/**
 * Authenticated fetch against `*.headout.com` APIs from the service worker.
 *
 * The browser won't attach `.headout.com` cookies to a fetch initiated by the
 * extension (different site + SameSite), and `Cookie`/`Referer` are forbidden
 * headers for `fetch`. So we read the full cookie set for the target URL and
 * inject it (plus an optional same-origin Referer) with a temporary
 * `declarativeNetRequest` rule, which we remove immediately afterwards to keep
 * the (network-wide) header rewrite window as small as possible.
 */
import { ERROR_CODES } from "./messages.js";
import { isOrySessionCookie } from "./session.js";

const DNR_RULE_ID = 1001;

const DEFAULT_HEADERS = {
  accept: "application/json, text/javascript, */*; q=0.01",
  "x-requested-with": "XMLHttpRequest",
};

/**
 * @param {import("../config.js").Environment} _env  Reserved for future per-env tweaks.
 * @param {string} url
 * @param {{ referer?: string, headers?: Record<string, string> } & RequestInit} [options]
 * @returns {Promise<Response>}
 */
export async function authenticatedFetch(_env, url, options = {}) {
  const { referer, headers, ...init } = options;

  const cookies = await chrome.cookies.getAll({ url });
  if (!cookies.some(isOrySessionCookie)) {
    throw new Error(ERROR_CODES.NOT_AUTHENTICATED);
  }

  const requestHeaders = [
    { header: "cookie", operation: "set", value: serializeCookies(cookies) },
  ];
  if (referer) {
    requestHeaders.push({ header: "referer", operation: "set", value: referer });
  }

  await setCookieInjectionRule(new URL(url).hostname, requestHeaders);
  try {
    return await fetch(url, {
      credentials: "include",
      headers: { ...DEFAULT_HEADERS, ...headers },
      ...init,
    });
  } finally {
    await clearCookieInjectionRule();
  }
}

function serializeCookies(cookies) {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

function setCookieInjectionRule(host, requestHeaders) {
  return chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [DNR_RULE_ID],
    addRules: [
      {
        id: DNR_RULE_ID,
        priority: 1,
        action: { type: "modifyHeaders", requestHeaders },
        condition: { requestDomains: [host], resourceTypes: ["xmlhttprequest"] },
      },
    ],
  });
}

function clearCookieInjectionRule() {
  return chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [DNR_RULE_ID],
  });
}
