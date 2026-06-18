# Headout Login Extension (Chrome MV3)

A Chrome extension that shares the Headout (EOS/Ory) login and adds a Zendesk
helper for booking lookups.

## Features

- **Login & open Google** (popup): detects the shared `.headout.com` Ory session.
  If logged in it opens Google; otherwise it opens the Ory login page, waits for
  login, then opens Google. Environment (Production / Test) is switchable.
- **Zendesk booking button** (content script on `headout.zendesk.com/agent/*`):
  adds a button next to the `Task #…` label. On click it reads the **Booking id**
  from the active ticket, calls the authenticated Aries API
  (`/apis/v2/order-fulfillment/booking/{id}`), and Google-searches the result.

## Authentication

Auth reuses the browser's shared `.headout.com` Ory session — no tokens are
stored. Because the extension origin is a different site (SameSite), the service
worker reads the full cookie set via `chrome.cookies` and injects it (plus a
same-origin `Referer`) using `declarativeNetRequest`. `Cookie`/`Referer` are
forbidden headers for `fetch`/axios, which is why DNR is required.

## Load it

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder
3. After editing files, click **reload ↻** on the extension card (and refresh any
   open Zendesk tab so the content script reloads)

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | MV3 manifest, permissions, content-script registration |
| `config.js` | Per-environment hosts (prod/test) + selected-env helper |
| `background.js` | Service worker: session check, login flow, authenticated `fetch` |
| `popup.{html,css,js}` | Popup UI (env toggle, login button, status) |
| `content.{js,css}` | Zendesk button + booking-id extraction |
