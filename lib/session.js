/** Headout login state, derived from the shared `.headout.com` Ory session cookie. */

const ORY_SESSION_COOKIE_PREFIX = "ory_session_";

/** True for a non-empty Ory session cookie (project id suffix varies by env). */
export function isOrySessionCookie(cookie) {
  return cookie.name.startsWith(ORY_SESSION_COOKIE_PREFIX) && Boolean(cookie.value);
}

/**
 * Whether a Headout session exists for the given environment.
 *
 * We read the cookie via `chrome.cookies` (which sees HttpOnly cookies and isn't
 * subject to SameSite) rather than calling an API, so detection works even though
 * the extension origin can't send the cookie on a normal fetch.
 *
 * @param {import("../config.js").Environment} env
 */
export async function isAuthenticated(env) {
  const cookies = await chrome.cookies.getAll({ domain: env.cookieDomain });
  return cookies.some(isOrySessionCookie);
}
