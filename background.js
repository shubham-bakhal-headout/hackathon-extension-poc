/**
 * Service worker: message router and the booking-autofill pipeline.
 *
 * Pipeline (triggered by the Zendesk button):
 *   1. Fetch booking details from Aries (authenticated).
 *   2. Resolve the vendor link from the vendor-tour endpoint.
 *   3. Fetch the autofill script for that link.
 *   4. Open the vendor link and run the script with the booking data.
 */
import { getEnvironment } from "./config.js";
import { resolveVendorLink, fetchBooking } from "./lib/aries.js";
import {
  fetchAutofillScript,
  runAutofillOnTab,
  runConfirmAfterPaymentOnTab,
} from "./lib/autofill.js";
import { MESSAGES, BOOKING_STATUS, ERROR_CODES } from "./lib/messages.js";
import { isAuthenticated } from "./lib/session.js";
import { createTab, waitForTabLoad } from "./lib/tabs.js";

const LOG = "[Headout Autofill]";

/**
 * The most recent booking run that reached PAYMENT_REQUIRED, kept so a later
 * CONFIRM_AFTER_PAYMENT can re-run the script's `confirmAfterPayment()` on the
 * same vendor tab. (Single-slot: one booking is driven at a time.)
 * @type {{ tabId: number, link: string, bookingId: string|number } | null}
 */
let pendingBooking = null;

/**
 * Booking id -> vendor link -> automation up to payment.
 * @param {string|number} bookingId
 * @returns {Promise<{ link: string, status: string, result: object }>}
 */
async function runBookingAutofill(bookingId) {
  const env = await getEnvironment();

  const booking = await fetchBooking(env, bookingId);
  const link = await resolveVendorLink(env, booking);
  const script = await fetchAutofillScript(link);

  const tab = await createTab(link);
  await waitForTabLoad(tab.id);
  const result = await runAutofillOnTab(tab.id, script, booking);

  const status = result?.status ?? BOOKING_STATUS.ERROR;
  pendingBooking =
    status === BOOKING_STATUS.PAYMENT_REQUIRED ? { tabId: tab.id, link, bookingId } : null;

  console.log(`${LOG} booking ${bookingId} -> ${status} on ${link}`, result);
  return { link, status, result };
}

/**
 * Re-run the generated script's `confirmAfterPayment()` on the vendor tab from
 * the last PAYMENT_REQUIRED run, to capture the order reference after the agent
 * has paid manually.
 * @returns {Promise<{ status: string, result: object }>}
 */
async function confirmAfterPayment() {
  if (!pendingBooking) throw new Error(ERROR_CODES.NO_PENDING_BOOKING);

  const env = await getEnvironment();
  const script = await fetchAutofillScript(pendingBooking.link);
  const result = await runConfirmAfterPaymentOnTab(pendingBooking.tabId, script);

  const status = result?.status ?? BOOKING_STATUS.ERROR;
  if (status === BOOKING_STATUS.CONFIRMED) pendingBooking = null;

  console.log(`${LOG} confirmAfterPayment -> ${status}`, result);
  return { status, result };
}

/** Handlers keyed by message type. Each returns the payload sent back to the caller. */
const HANDLERS = {
  [MESSAGES.AUTH_STATUS]: async () => {
    const env = await getEnvironment();
    return { authenticated: await isAuthenticated(env), env: env.key };
  },

  [MESSAGES.OPEN_LOGIN]: async () => {
    const env = await getEnvironment();
    const loginUrl = `${env.oryBase}/ui/login?return_to=${encodeURIComponent(env.eos)}`;
    await createTab(loginUrl);
    return {};
  },

  [MESSAGES.RUN_BOOKING_AUTOFILL]: ({ bookingId }) => runBookingAutofill(bookingId),

  [MESSAGES.CONFIRM_AFTER_PAYMENT]: () => confirmAfterPayment(),
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = HANDLERS[message?.type];
  if (!handler) return false;

  Promise.resolve(handler(message))
    .then((data) => sendResponse({ ok: true, ...data }))
    .catch((error) => {
      console.error(`${LOG} ${message.type} failed:`, error);
      sendResponse({ ok: false, error: error?.message ?? String(error) });
    });

  return true; // keep the channel open for the async response
});
