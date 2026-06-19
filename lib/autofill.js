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

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Autofill service returned ${res.status}`);
  return res.text();
}

/**
 * Run the script on the tab and call its fill() with the given data.
 *
 * The script registers `window.HeadoutOrderFormAutofill`; we then invoke
 * `fill(data)` in the same USER_SCRIPT world, which shares the page DOM.
 *
 * @param {number} tabId
 * @param {string} script
 * @param {unknown} data
 */
export async function runAutofillOnTab(tabId, script, data) {
  const userScripts = getUserScriptsApi();
  if (!userScripts) throw new Error(ERROR_CODES.USER_SCRIPTS_DISABLED);

  await userScripts.execute({
    target: { tabId },
    world: "USER_SCRIPT",
    js: [{ code: buildInjection(script, data) }],
  });
}

/** `chrome.userScripts` throws on access when the API is disabled; treat as null. */
function getUserScriptsApi() {
  try {
    return chrome.userScripts ?? null;
  } catch {
    return null;
  }
}

function buildInjection(script, data) {
  return `${script}
;(async () => {
  const api = window.HeadoutOrderFormAutofill;
  if (!api || typeof api.fill !== "function") {
    console.error("[Headout Autofill] HeadoutOrderFormAutofill.fill not found");
    return;
  }
  try {
    const result = await api.fill(${JSON.stringify(data)});
    console.log("[Headout Autofill] result:", result);
  } catch (error) {
    console.error("[Headout Autofill] fill failed:", error);
  }
})();`;
}
