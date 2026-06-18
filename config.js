// Environment configuration.
//
// Auth is shared via the `.headout.com` Ory session cookie, so we never read the
// cookie directly — credentialed fetches to `smcBase` carry it automatically.
// `eos` is used as the `return_to` target for the Ory login flow.
export const ENVIRONMENTS = {
  prod: {
    label: "Production",
    oryBase: "https://auth.headout.com",
    smcBase: "https://smc.headout.com",
    ariesBase: "https://aries.headout.com",
    eos: "https://eos.headout.com",
    // Registrable domain the Ory session cookie is scoped to (`.headout.com`).
    cookieDomain: "headout.com",
  },
  test: {
    label: "Test / Staging",
    // NOTE: test Ory host is assumed; update here if staging auth differs.
    oryBase: "https://auth.test-headout.com",
    smcBase: "https://smc.test-headout.com",
    ariesBase: "https://aries.test-headout.com",
    eos: "https://eos.test-headout.com",
    cookieDomain: "test-headout.com",
  },
};

export const DEFAULT_ENV = "prod";

// Resolve the currently selected environment from chrome.storage.local.
export async function getEnv() {
  const { selectedEnv } = await chrome.storage.local.get("selectedEnv");
  const key = ENVIRONMENTS[selectedEnv] ? selectedEnv : DEFAULT_ENV;
  return { key, ...ENVIRONMENTS[key] };
}
