/**
 * Zendesk agent ticket content script.
 *
 * Adds a button next to the "Task #<id>" label. On click it reads the Booking id
 * from the active ticket and asks the service worker to run the booking-autofill
 * pipeline (fetch booking -> vendor link -> autofill script -> open & fill).
 *
 * Zendesk is a SPA that keeps multiple ticket panes mounted and hides inactive
 * ones, so we anchor to the *visible* Task label and read from the *active*
 * ticket only, re-checking on DOM mutations.
 */
(() => {
  "use strict";

  // Mirror of MESSAGES.RUN_BOOKING_AUTOFILL — content scripts can't import modules.
  const RUN_BOOKING_AUTOFILL = "RUN_BOOKING_AUTOFILL";

  const BUTTON_ID = "hd-autofill-btn";
  const IDLE_LABEL = "🔗 Autofill vendor form";
  const BUSY_LABEL = "⏳ Working…";
  const FLASH_MS = 3000;

  /** Visible "Task #<digits>" label element, or null. */
  function findVisibleTaskLabel() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!/Task #\d+/.test(node.nodeValue ?? "")) return NodeFilter.FILTER_SKIP;
        const el = node.parentElement;
        return el && el.offsetParent !== null
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      },
    });
    return walker.nextNode()?.parentElement ?? null;
  }

  /**
   * Booking id from the active ticket. Prefers an explicit "Booking Id: <n>" in
   * the visible body, then the document title ("Booking: <n> - …"), then any
   * visible "Booking: <n>".
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
      document.title.match(/Booking:\s*(\d{4,})/i)?.[1] ??
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
        return "Enable 'Allow user scripts' on the extension";
      default:
        return `Failed${code ? `: ${code}` : ""}`;
    }
  }

  async function onClick(event) {
    const button = event.currentTarget;
    const bookingId = getBookingId();
    if (!bookingId) {
      flashError(button, "Booking ID not found");
      return;
    }

    button.disabled = true;
    setLabel(button, BUSY_LABEL);

    const response = await sendMessage({ type: RUN_BOOKING_AUTOFILL, bookingId });

    button.disabled = false;
    if (response?.ok) {
      setLabel(button, IDLE_LABEL);
    } else {
      flashError(button, describeError(response?.error));
    }
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

  /** Keep one button next to the currently visible Task label. */
  function ensureButton() {
    const label = findVisibleTaskLabel();
    if (!label) return;

    const existing = document.getElementById(BUTTON_ID);
    const placedCorrectly =
      existing?.isConnected &&
      existing.offsetParent !== null &&
      existing.parentElement === label.parentElement;
    if (placedCorrectly) return;

    existing?.remove();
    label.insertAdjacentElement("afterend", createButton());
  }

  // React to the SPA's DOM changes (debounced).
  let pending = false;
  const scheduleEnsure = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      ensureButton();
    }, 300);
  };

  new MutationObserver(scheduleEnsure).observe(document.body, {
    childList: true,
    subtree: true,
  });
  ensureButton();
})();
