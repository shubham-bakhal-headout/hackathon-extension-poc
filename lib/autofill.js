/**
 * Fetch the form-autofill script from the local service and run it on a tab.
 *
 * We use the `chrome.userScripts` API rather than `chrome.scripting` + eval:
 * MV3's CSP blocks `eval`/`new Function` in the content-script world, and a
 * strict page CSP (e.g. Google Forms) blocks it in MAIN. `userScripts` is the
 * sanctioned way to execute remotely-fetched code — it requires the user to
 * enable "Allow user scripts" on the extension's details page.
 */
import { AUTOFILL_SERVICE } from "../config.js";
import { ERROR_CODES } from "./messages.js";

/**
 * Fetch the generic autofill script, passing the vendor link as a query param.
 * @param {string} link
 * @returns {Promise<string>} The script source.
 */
export async function fetchAutofillScript(link) {
  const url = new URL(AUTOFILL_SERVICE.scriptUrl);
  url.searchParams.set(AUTOFILL_SERVICE.linkParam, link);
  // Ask for raw JavaScript — the resolve endpoint otherwise returns a JSON
  // envelope ({ data: { content } }), which is not executable as an injected script.
  url.searchParams.set("format", "js");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Autofill service returned ${res.status}`);
  return res.text();
}

/**
 * Run the script on the tab and drive the booking up to payment.
 *
 * The generated script (see the generate-automate-script skill) registers
 * `window.HeadoutAutomation` and exposes `run(booking)`, which walks the vendor
 * funnel and resolves to `{ status, ... }` — `PAYMENT_REQUIRED` when it reaches
 * the payment page (it never pays). We invoke it in the same USER_SCRIPT world,
 * which shares the page DOM, and return the script's structured result.
 *
 * A legacy fallback to `window.HeadoutOrderFormAutofill.fill(booking)` is kept so
 * the mock-server's older autofill scripts still work in development.
 *
 * @param {number} tabId
 * @param {string} script
 * @param {unknown} booking
 * @returns {Promise<object>} The script's result (`{ status, ... }`).
 */
export async function runAutofillOnTab(tabId, script, booking) {
  return executeInScriptWorld(tabId, script, runCall(booking));
}

/**
 * After the agent has paid by hand, re-inject the script and call its
 * `confirmAfterPayment()` to read the order/confirmation reference.
 *
 * @param {number} tabId
 * @param {string} script
 * @returns {Promise<object>} The script's result (`{ status, reference, ... }`).
 */
export async function runConfirmAfterPaymentOnTab(tabId, script) {
  return executeInScriptWorld(tabId, script, confirmCall());
}

/** Inject `script` + a trailing `invocation` expression and return its resolved value. */
async function executeInScriptWorld(tabId, script, invocation) {
  const userScripts = getUserScriptsApi();
  if (!userScripts) throw new Error(ERROR_CODES.USER_SCRIPTS_DISABLED);

  const results = await userScripts.execute({
    target: { tabId },
    world: "USER_SCRIPT",
    js: [{ code: `${script}\n;${invocation}` }],
  });

  // `userScripts.execute` awaits a returned promise and surfaces its value.
  const result = results?.[0]?.result;
  return result ?? { status: "ERROR", error: ERROR_CODES.AUTOMATION_API_MISSING };
}

/** `chrome.userScripts` throws on access when the API is disabled; treat as null. */
function getUserScriptsApi() {
  try {
    return chrome.userScripts ?? null;
  } catch {
    return null;
  }
}

/**
 * Expression that invokes the booking run, preferring the HeadoutAutomation
 * contract and falling back to the legacy autofill API. The IIFE returns the
 * result so `userScripts.execute` can surface it back to the service worker.
 */
function runCall(booking) {
  const json = JSON.stringify(booking);
  return `(() => {
  const automation = window.HeadoutAutomation;
  if (automation && typeof automation.run === "function") {
    return Promise.resolve(automation.run(${json})).catch((e) => ({ status: "ERROR", error: String(e && e.message || e) }));
  }
  const legacy = window.HeadoutOrderFormAutofill;
  if (legacy && typeof legacy.fill === "function") {
    return Promise.resolve(legacy.fill(${json}))
      .then((result) => ({ status: "CONFIRMED", legacy: true, result }))
      .catch((e) => ({ status: "ERROR", error: String(e && e.message || e) }));
  }
  return { status: "ERROR", error: "${ERROR_CODES.AUTOMATION_API_MISSING}" };
})();`;
}

function confirmCall() {
  return `(() => {
  const automation = window.HeadoutAutomation;
  if (automation && typeof automation.confirmAfterPayment === "function") {
    return Promise.resolve(automation.confirmAfterPayment()).catch((e) => ({ status: "ERROR", error: String(e && e.message || e) }));
  }
  return { status: "ERROR", error: "${ERROR_CODES.AUTOMATION_API_MISSING}" };
})();`;
}
