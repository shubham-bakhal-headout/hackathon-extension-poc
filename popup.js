const envSelect = document.getElementById("env");
const statusEl = document.getElementById("status");
const loginBtn = document.getElementById("login");

const DEFAULT_ENV = "prod";

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = `status status--${kind}`;
}

function sendMessage(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

// Ask the background worker whether the current env has a valid session.
async function refreshStatus() {
  setStatus("Checking session…", "unknown");
  loginBtn.disabled = true;
  const res = await sendMessage({ type: "CHECK" });
  if (res?.authenticated) {
    setStatus("Logged in ✓", "ok");
    loginBtn.textContent = "Open Google";
  } else {
    setStatus("Not logged in", "warn");
    loginBtn.textContent = "Login & open Google";
  }
  loginBtn.disabled = false;
}

async function init() {
  const { selectedEnv } = await chrome.storage.local.get("selectedEnv");
  envSelect.value = selectedEnv || DEFAULT_ENV;
  await refreshStatus();
}

envSelect.addEventListener("change", async () => {
  await chrome.storage.local.set({ selectedEnv: envSelect.value });
  await refreshStatus();
});

loginBtn.addEventListener("click", async () => {
  loginBtn.disabled = true;
  setStatus("Opening login…", "unknown");

  const res = await sendMessage({ type: "LOGIN" });

  if (res?.status === "authenticated" || res?.status === "logged_in") {
    setStatus("Logged in ✓ — opened Google", "ok");
  } else if (res?.status === "login_timeout") {
    setStatus("Login timed out. Try again.", "warn");
  } else {
    setStatus("Something went wrong. Try again.", "warn");
  }
  loginBtn.disabled = false;
});

init();
