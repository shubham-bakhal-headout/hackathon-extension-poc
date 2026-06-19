import { SERVER_BASE } from "../config.js";
import { BOOKING_STATUS } from "./messages.js";

const EVENTS_URL = `${SERVER_BASE}/api/events`;

/**
 * Map a booking-automation status to the observability server's fill status.
 *   CONFIRMED        -> SUCCESS  (order placed / form completed)
 *   PAYMENT_REQUIRED -> PARTIAL  (automation drove the funnel up to payment)
 *   ERROR / other    -> FAILURE
 * @param {string} status
 * @returns {'SUCCESS'|'PARTIAL'|'FAILURE'}
 */
export function mapStatus(status) {
  if (status === BOOKING_STATUS.CONFIRMED) return "SUCCESS";
  if (status === BOOKING_STATUS.PAYMENT_REQUIRED) return "PARTIAL";
  return "FAILURE";
}

/**
 * Report a booking run to the observability server. Fire-and-forget: never
 * throws, so telemetry can't break the automation flow.
 *
 * @param {{
 *   vendorUrl: string;
 *   userEmail: string;
 *   userName?: string;
 *   bookingId?: string | number;
 *   status: string;            // BOOKING_STATUS value
 *   result?: object;           // the script's structured result
 *   durationMs?: number;
 * }} params
 */
export async function reportBookingEvent({ vendorUrl, userEmail, userName, bookingId, status, result, durationMs }) {
  try {
    // Legacy autofill scripts return per-field results inside result.result.results;
    // forward them so the server can flag field-level script failures.
    const fieldResults =
      result && result.legacy && Array.isArray(result.result?.results) ? result.result.results : [];

    await fetch(EVENTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendorUrl,
        userEmail,
        userName,
        bookingId: bookingId ? String(bookingId) : undefined,
        status: mapStatus(status),
        durationMs,
        fieldResults,
        error: result?.error,
      }),
    });
  } catch {
    // intentionally swallowed — telemetry is best-effort
  }
}
