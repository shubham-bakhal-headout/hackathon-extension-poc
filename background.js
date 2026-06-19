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
import { fetchAutofillScript, runAutofillOnTab } from "./lib/autofill.js";
import { MESSAGES } from "./lib/messages.js";
import { isAuthenticated } from "./lib/session.js";
import { createTab, waitForTabLoad } from "./lib/tabs.js";

const LOG = "[Headout Autofill]";

/**
 * Booking id -> vendor link -> autofill. Returns the opened link.
 * @param {string|number} bookingId
 */
async function runBookingAutofill(bookingId) {
  const env = await getEnvironment();

  const booking = await fetchBooking(env, bookingId);
  const link = await resolveVendorLink(env, booking);
  const script = await fetchAutofillScript(link);

  const tab = await createTab(link);
  await waitForTabLoad(tab.id);
  await runAutofillOnTab(tab.id, script, booking);

  console.log(`${LOG} autofilled ${link} for booking ${bookingId}`);
  return { link };
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
