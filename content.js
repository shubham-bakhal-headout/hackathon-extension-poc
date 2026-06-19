/**
 * Zendesk agent ticket content script (works on any `*.zendesk.com` org).
 *
 * Renders a fixed floating button — placement is anchored to the viewport, not
 * to any Zendesk DOM/text, so it's robust across orgs and layout changes. On
 * click it reads the Booking id from the active ticket and asks the service
 * worker to run the booking-autofill pipeline.
 */
(() => {
  "use strict";

  // Mirrors of lib/messages.js — content scripts can't import modules. Keep in sync.
  const RUN_BOOKING_AUTOFILL = "RUN_BOOKING_AUTOFILL";
  const CONFIRM_AFTER_PAYMENT = "CONFIRM_AFTER_PAYMENT";
  const STATUS = { PAYMENT_REQUIRED: "PAYMENT_REQUIRED", CONFIRMED: "CONFIRMED", ERROR: "ERROR" };

  const BUTTON_ID = "hd-autofill-btn";
  const IDLE_LABEL = "Automate Booking";
  const BUSY_LABEL = "Automating…";
  const CONFIRM_LABEL = "Paid? Confirm booking";
  const CONFIRMING_LABEL = "Confirming…";
  const FLASH_MS = 3000;

  /** Button mode: "run" starts the booking; "confirm" reads the order ref post-payment. */
  let mode = "run";

  /**
   * Booking id from the active ticket. Prefers an explicit "Booking Id: <n>" in
   * the visible text, then the document title ("Booking id: <n>"), then any
   * visible "Booking: <n>". Reads only visible nodes so hidden ticket panes
   * (other open tabs) don't interfere.
   */
  function getBookingId() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!/booking/i.test(node.nodeValue ?? "")) return NodeFilter.FILTER_SKIP;
        const el = node.parentElement;
        return el && el.offsetParent !== null
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      },
    });

    const parts = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      parts.push(node.nodeValue);
    }
    const body = parts.join("\n");

    return (
      body.match(/Booking\s*[_ ]?Id\s*[:#]?\s*(\d{4,})/i)?.[1] ??
      document.title.match(/Booking\s*[_ ]?id\s*[:#]?\s*(\d{4,})/i)?.[1] ??
      body.match(/Booking:\s*(\d{4,})/i)?.[1] ??
      null
    );
  }

  function sendMessage(message) {
    return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
  }

  function setLabel(button, text, isError = false) {
    button.textContent = text;
    button.classList.toggle("hd-autofill-btn--error", isError);
  }

  function flashError(button, text) {
    setLabel(button, text, true);
    setTimeout(() => setLabel(button, IDLE_LABEL), FLASH_MS);
  }

  function describeError(code) {
    switch (code) {
      case "NOT_AUTHENTICATED":
        return "Not logged in to Headout";
      case "USER_SCRIPTS_DISABLED":
        return "Enable 'Allow user scripts'";
      case "AUTOMATION_API_MISSING":
        return "Script has no automation API";
      case "NO_PENDING_BOOKING":
        return "No booking awaiting payment";
      default:
        return `Failed${code ? `: ${code}` : ""}`;
    }
  }

  /** Switch the button into the post-payment "confirm" mode. */
  function enterConfirmMode(button) {
    mode = "confirm";
    setLabel(button, CONFIRM_LABEL);
  }

  function resetToRun(button, label = IDLE_LABEL) {
    mode = "run";
    setLabel(button, label);
  }

  /** Start the booking: booking id -> vendor link -> automation up to payment. */
  async function runBooking(button) {
    const bookingId = getBookingId();
    if (!bookingId) {
      flashError(button, "Booking ID not found");
      return;
    }

    button.disabled = true;
    setLabel(button, BUSY_LABEL);
    const response = await sendMessage({ type: RUN_BOOKING_AUTOFILL, bookingId });
    button.disabled = false;

    if (!response?.ok) {
      flashError(button, describeError(response?.error));
      return;
    }
    const result = response.result ?? {};
    if (response.status === STATUS.PAYMENT_REQUIRED) {
      enterConfirmMode(button); // vendor tab is parked on the payment page
    } else if (response.status === STATUS.CONFIRMED) {
      flashSuccess(button, result.reference ? `Booked ✓ ${result.reference}` : "Booked ✓");
    } else {
      flashError(button, describeError(result.error || result.code));
    }
  }

  /** After the agent has paid manually, read the order reference. */
  async function confirmPayment(button) {
    button.disabled = true;
    setLabel(button, CONFIRMING_LABEL);
    const response = await sendMessage({ type: CONFIRM_AFTER_PAYMENT });
    button.disabled = false;

    const result = response?.result ?? {};
    if (response?.ok && response.status === STATUS.CONFIRMED) {
      resetToRun(button);
      flashSuccess(button, result.reference ? `Booked ✓ ${result.reference}` : "Booked ✓");
      return;
    }
    // Stay in confirm mode so the agent can retry once payment is truly done.
    const code = response?.ok ? result.error || result.code : response?.error;
    setLabel(button, describeError(code), true);
    setTimeout(() => setLabel(button, CONFIRM_LABEL), FLASH_MS);
  }

  function flashSuccess(button, text) {
    setLabel(button, text);
    setTimeout(() => resetToRun(button), FLASH_MS);
  }

  function onClick(event) {
    const button = event.currentTarget;
    return mode === "confirm" ? confirmPayment(button) : runBooking(button);
  }

  function createButton() {
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className = "hd-autofill-btn";
    button.textContent = IDLE_LABEL;
    button.addEventListener("click", onClick);
    return button;
  }

  /** Keep the floating button present (re-add if the SPA ever removes it). */
  function ensureButton() {
    if (!document.getElementById(BUTTON_ID)) {
      document.body.appendChild(createButton());
    }
  }

  new MutationObserver(ensureButton).observe(document.body, { childList: true });
  ensureButton();
})();
