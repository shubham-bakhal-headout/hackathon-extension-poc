/**
 * Message protocol between the popup / content script and the service worker.
 *
 * NOTE: content scripts cannot import ES modules, so `content.js` repeats the
 * `RUN_BOOKING_AUTOFILL` string literal. Keep them in sync.
 */
export const MESSAGES = Object.freeze({
  /** Popup -> worker: is there a valid Headout session for the current env? */
  AUTH_STATUS: "AUTH_STATUS",
  /** Popup -> worker: open the Ory login page. */
  OPEN_LOGIN: "OPEN_LOGIN",
  /** Content -> worker: run the booking -> vendor -> autofill pipeline. */
  RUN_BOOKING_AUTOFILL: "RUN_BOOKING_AUTOFILL",
});

/** Stable error codes returned to the UI so it can show tailored messages. */
export const ERROR_CODES = Object.freeze({
  NOT_AUTHENTICATED: "NOT_AUTHENTICATED",
  USER_SCRIPTS_DISABLED: "USER_SCRIPTS_DISABLED",
});
