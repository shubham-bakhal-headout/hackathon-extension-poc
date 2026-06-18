// Content script for Headout Zendesk agent ticket pages.
//
// Adds a "Search booking on Google" button next to the "Task #<id>" label in the
// ticket header. On click it reads the Booking id from the ticket UI (NOT the
// Task/ticket id in the URL) and opens a Google search for it.
//
// Zendesk is a single-page app that keeps multiple ticket panes in the DOM and
// hides inactive ones, so we (a) anchor to the *visible* Task label, (b) read the
// booking id from the *active* ticket only, and (c) re-check on DOM mutations.
(function () {
  const BTN_ID = "hd-booking-search-btn";

  // --- Find the visible "Task #<digits>" label to anchor the button to. -------
  function findVisibleTaskBadge() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!/Task #\d+/.test(node.nodeValue || "")) return NodeFilter.FILTER_SKIP;
        const el = node.parentElement;
        // Only the active ticket's header is visible (offsetParent !== null).
        if (!el || el.offsetParent === null) return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const node = walker.nextNode();
    return node ? node.parentElement : null;
  }

  // --- Extract the Booking id from the active ticket. -------------------------
  // Priority: explicit "Booking Id: <n>" in the visible body, then the document
  // title (always the active ticket's subject "Booking: <n> - …"), then any
  // visible "Booking: <n>".
  function getBookingId() {
    // 1) Visible body text that mentions "booking" (excludes hidden panes).
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!/booking/i.test(node.nodeValue || "")) return NodeFilter.FILTER_SKIP;
        const el = node.parentElement;
        if (!el || el.offsetParent === null) return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const visibleText = [];
    let node;
    while ((node = walker.nextNode())) visibleText.push(node.nodeValue);
    const body = visibleText.join("\n");

    // Matches "Booking Id: 32219261", "Booking_Id:32219261", "Booking ID 32219261".
    let m = body.match(/Booking\s*[_ ]?Id\s*[:#]?\s*(\d{4,})/i);
    if (m) return m[1];

    // 2) Document title reliably reflects the ACTIVE ticket subject.
    m = (document.title || "").match(/Booking:\s*(\d{4,})/i);
    if (m) return m[1];

    // 3) Fallback: any visible "Booking: <n>".
    m = body.match(/Booking:\s*(\d{4,})/i);
    return m ? m[1] : null;
  }

  function createButton() {
    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.className = "hd-booking-search-btn";
    btn.textContent = "🔎 Search booking on Google";
    btn.addEventListener("click", onClick);
    return btn;
  }

  const LABEL = "🔎 Search booking on Google";

  function flash(btn, text) {
    btn.textContent = text;
    btn.classList.add("hd-booking-search-btn--error");
    setTimeout(() => {
      btn.textContent = LABEL;
      btn.classList.remove("hd-booking-search-btn--error");
    }, 2500);
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const btn = e.currentTarget;
    const bookingId = getBookingId();

    if (!bookingId) {
      flash(btn, "Booking ID not found");
      return;
    }

    btn.disabled = true;
    btn.textContent = "⏳ Looking up booking…";

    // Background calls the Aries API (authenticated) and Google-searches the result.
    chrome.runtime.sendMessage(
      { type: "BOOKING_LOOKUP", bookingId },
      (resp) => {
        btn.disabled = false;
        btn.textContent = LABEL;
        if (!resp || !resp.ok) {
          flash(
            btn,
            resp?.error === "NOT_AUTHENTICATED"
              ? "Not logged in to Headout"
              : `Lookup failed${resp?.error ? `: ${resp.error}` : ""}`
          );
        }
      }
    );
  }

  // Ensure exactly one button sits next to the currently visible Task label.
  function ensureButton() {
    const badge = findVisibleTaskBadge();
    if (!badge) return;

    const existing = document.getElementById(BTN_ID);
    if (
      existing &&
      existing.isConnected &&
      existing.offsetParent !== null &&
      existing.parentElement === badge.parentElement
    ) {
      return; // already placed correctly for the active ticket
    }
    if (existing) existing.remove();

    badge.insertAdjacentElement("afterend", createButton());
  }

  // --- React to Zendesk's SPA DOM changes (debounced). ------------------------
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      ensureButton();
    }, 300);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });

  ensureButton();
})();
