// Service worker: session detection, login orchestration, tab opening, and an
// authenticated-fetch helper for future Headout API calls.
//
// Why not just `fetch('/api/mmp/user', {credentials:'include'})` like mmp-builder?
// The Ory session cookie is `SameSite=Lax` and scoped to `.headout.com`. The
// extension's origin (`chrome-extension://…`) is a *different site*, so Chrome
// will NOT attach that cookie to a fetch initiated from the service worker.
// (It works inside the app only because eos.headout.com and smc.headout.com are
// the same site.) So we read the cookie directly via `chrome.cookies` — which
// works regardless of SameSite and even for HttpOnly cookies — and inject it
// into API requests with `declarativeNetRequest`.
import { getEnv } from "./config.js";

const GOOGLE_URL = "https://www.google.com";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120000;
const ORY_COOKIE_PREFIX = "ory_session_";
const DNR_RULE_ID = 1001;

// Find the Ory session cookie for the given environment, regardless of the exact
// project-specific cookie name. Returns the chrome.cookies.Cookie or null.
async function getSessionCookie(env) {
  try {
    const cookies = await chrome.cookies.getAll({ domain: env.cookieDomain });
    return (
      cookies.find((c) => c.name.startsWith(ORY_COOKIE_PREFIX) && c.value) ||
      null
    );
  } catch (err) {
    console.warn("[Headout Login] cookie read failed:", err);
    return null;
  }
}

// Source of truth for "is the user logged in": does a Headout Ory session exist?
async function checkSession(env) {
  return Boolean(await getSessionCookie(env));
}

// Make an authenticated request to any *.headout.com API (SMC, Aries, …).
//
// The browser won't attach the .headout.com cookies to a fetch initiated from
// the extension (different site + SameSite), so we read the FULL cookie set for
// the target URL (ory_session, JSESSIONID, csrf_token, …) via chrome.cookies and
// inject it — plus an optional same-origin Referer — using declarativeNetRequest.
// `Cookie` and `Referer` are forbidden headers for fetch/axios, which is exactly
// why this has to go through DNR. The rule is removed right after the request to
// keep the (network-wide) header-rewrite window tiny.
// Usage: await authFetchUrl(env, "https://aries.headout.com/apis/v2/…", { referer })
export async function authFetchUrl(env, fullUrl, options = {}) {
  const { referer, headers, ...fetchOpts } = options;

  // All cookies the browser would send to this exact URL (incl. HttpOnly).
  const cookies = await chrome.cookies.getAll({ url: fullUrl });
  const hasSession = cookies.some(
    (c) => c.name.startsWith(ORY_COOKIE_PREFIX) && c.value
  );
  if (!hasSession) throw new Error("NOT_AUTHENTICATED");
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  const requestHeaders = [
    { header: "cookie", operation: "set", value: cookieHeader },
  ];
  if (referer) {
    requestHeaders.push({ header: "referer", operation: "set", value: referer });
  }

  const host = new URL(fullUrl).hostname;
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [DNR_RULE_ID],
    addRules: [
      {
        id: DNR_RULE_ID,
        priority: 1,
        action: { type: "modifyHeaders", requestHeaders },
        condition: {
          requestDomains: [host],
          resourceTypes: ["xmlhttprequest"],
        },
      },
    ],
  });

  try {
    return await fetch(fullUrl, {
      credentials: "include",
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        "x-requested-with": "XMLHttpRequest",
        ...(headers || {}),
      },
      ...fetchOpts,
    });
  } finally {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [DNR_RULE_ID],
    });
  }
}

// Convenience wrapper for SMC API paths.
export async function authFetch(env, path, options = {}) {
  return authFetchUrl(env, `${env.smcBase}${path}`, options);
}

function openGoogle() {
  return chrome.tabs.create({ url: GOOGLE_URL });
}

// Google caps the query length; keep the URL well under browser limits.
const MAX_QUERY_LEN = 600;

function openGoogleSearch(query) {
  const q = String(query).slice(0, MAX_QUERY_LEN);
  return chrome.tabs.create({
    url: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  });
}

// Call the Aries booking API with the booking id, then Google-search the result.
async function handleBookingLookup(bookingId) {
  const env = await getEnv();
  const id = encodeURIComponent(bookingId);
  const url = `${env.ariesBase}/apis/v2/order-fulfillment/booking/${id}`;
  const referer = `${env.ariesBase}/bms/booking/${id}`;

  try {
    const res = await authFetchUrl(env, url, { referer });
    const text = await res.text();

    if (!res.ok) {
      return { ok: false, error: `API ${res.status}`, status: res.status };
    }

    // Per request: search Google with whatever the API returns.
    await openGoogleSearch(text);
    return { ok: true, status: res.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

// Poll until a Headout session cookie appears, or timeout.
async function waitForLogin(env) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    if (await checkSession(env)) return true;
  }
  return false;
}

// Orchestrates: check -> (login if needed) -> open Google.
async function handleLogin() {
  const env = await getEnv();

  if (await checkSession(env)) {
    await openGoogle();
    return { status: "authenticated" };
  }

  const loginUrl = `${env.oryBase}/ui/login?return_to=${encodeURIComponent(env.eos)}`;
  await chrome.tabs.create({ url: loginUrl });

  const ok = await waitForLogin(env);
  if (ok) {
    await openGoogle();
    return { status: "logged_in" };
  }
  return { status: "login_timeout" };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CHECK") {
    (async () => {
      const env = await getEnv();
      const authenticated = await checkSession(env);
      sendResponse({ authenticated, env: env.key });
    })();
    return true; // async response
  }

  if (message?.type === "LOGIN") {
    handleLogin().then(sendResponse);
    return true; // async response
  }

  // From the Zendesk content script: look up the booking via the Aries API
  // (authenticated) and open a Google search with the result.
  if (message?.type === "BOOKING_LOOKUP" && message.bookingId) {
    handleBookingLookup(message.bookingId).then(sendResponse);
    return true; // async response
  }

  // From the Zendesk content script: open a Google search for a raw query.
  if (message?.type === "OPEN_SEARCH" && message.query) {
    openGoogleSearch(message.query);
    sendResponse({ ok: true });
    return true;
  }

  return false;
});
