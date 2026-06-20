# Headout Vendor Autofill (Chrome MV3)

From a Headout Zendesk ticket, look up the booking in Aries and autofill the
vendor's order form — reusing the agent's existing Headout login.

## Flow

1. A button is injected next to the **Task #** label on `headout.zendesk.com/agent/*`.
2. On click, the content script reads the **Booking id** from the active ticket
   and asks the service worker to run the pipeline:
   1. `fetchBooking` — `GET /apis/v2/order-fulfillment/booking/{id}` (Aries).
   2. `fetchGuestDetails` — `GET /booking/{id}/guestDetails` (Aries), added as
      `booking.guestDetails` before the automation runs.
   3. `resolveVendorLink` — `GET /apis/vendor-tour?vendorId=&tourId=`, then extract
      the link from the response.
   4. `fetchAutofillScript` — `GET <local>/autofill-script?link=<vendorLink>`.
   5. Open the vendor link, then run the script with the booking data via the
      `userScripts` API.

## Authentication

Auth reuses the browser's shared `.headout.com` Ory session — no tokens stored.
Because the extension origin is a different site (SameSite), the service worker
reads the full cookie set via `chrome.cookies` and injects it (plus a same-origin
`Referer`) using `declarativeNetRequest`. `Cookie`/`Referer` are forbidden headers
for `fetch`, which is why this goes through DNR. See `lib/auth-fetch.js`.

## Setup

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this folder.
3. On the extension's **Details** page, turn on **"Allow user scripts"**
   (required to execute the fetched autofill script).
4. Run the local autofill service on `http://127.0.0.1:3000`.

After editing files, click **reload ↻** on the extension card and refresh any open
Zendesk tab so the content script reloads.

## Layout

```
manifest.json        MV3 manifest, permissions, content-script registration
config.js            Environments (prod/test) + autofill service config
background.js        Service worker: message router + pipeline orchestration
lib/
  messages.js        Message protocol + error codes
  session.js         Ory session detection (login state)
  auth-fetch.js      Authenticated fetch (cookie/referer injection via DNR)
  aries.js           Aries client: booking, guest details, vendor link
  autofill.js        Fetch + run the autofill script (userScripts API)
  tabs.js            Tab helpers (create, wait-for-load)
popup.{html,js,css}  Auth status + environment switcher
content.{js,css}     Zendesk button + booking-id extraction
```
