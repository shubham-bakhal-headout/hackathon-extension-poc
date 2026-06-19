import {
  DEFAULT_ENVIRONMENT_KEY,
  ENVIRONMENTS,
  getEnvironment,
  setEnvironment,
} from "./config.js";
import { MESSAGES } from "./lib/messages.js";

const envSelect = document.getElementById("env");
const statusEl = document.getElementById("status");
const loginBtn = document.getElementById("login");

const sendMessage = (message) =>
  new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = `status status--${kind}`;
}

function renderEnvironmentOptions(selectedKey) {
  envSelect.replaceChildren(
    ...Object.entries(ENVIRONMENTS).map(([key, { label }]) => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = label;
      option.selected = key === selectedKey;
      return option;
    })
  );
}

async function refreshStatus() {
  setStatus("Checking session…", "unknown");
  loginBtn.hidden = true;

  const response = await sendMessage({ type: MESSAGES.AUTH_STATUS });
  if (response?.authenticated) {
    setStatus("Logged in ✓", "ok");
  } else {
    setStatus("Not logged in", "warn");
    loginBtn.hidden = false;
  }
}

envSelect.addEventListener("change", async () => {
  await setEnvironment(envSelect.value);
  await refreshStatus();
});

loginBtn.addEventListener("click", async () => {
  await sendMessage({ type: MESSAGES.OPEN_LOGIN });
  window.close();
});

async function init() {
  const env = await getEnvironment();
  renderEnvironmentOptions(env.key ?? DEFAULT_ENVIRONMENT_KEY);
  await refreshStatus();
}

init();
