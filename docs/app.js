const productEl = document.getElementById("product");
const keyEl = document.getElementById("key");
const code42El = document.getElementById("code42");
const codeLabelEl = document.getElementById("codeLabel");
const btnCheck = document.getElementById("btnCheck");
const btnActivate = document.getElementById("btnActivate");
const statusEl = document.getElementById("status");
const serviceHealthEl = document.getElementById("serviceHealth");
const healthTextEl = document.getElementById("healthText");
const turnstileWidgetEl = document.getElementById("turnstile-widget");

const API_BASE = (window.ACTIVATE_API_BASE || "").replace(/\/$/, "");
const TURNSTILE_SITE_KEY = (window.TURNSTILE_SITE_KEY || "").trim();

let browserChallengeId = "";
let turnstileToken = "";
let turnstileWidgetId = null;

function updateCodeFieldForProduct() {
  const isOnetap = productEl.value === "onetap";
  codeLabelEl.textContent = isOnetap
    ? "Registration Code (from Onetap app)"
    : "Registration Code (42 characters)";
  code42El.placeholder = isOnetap
    ? "Paste your Onetap registration code"
    : "Paste code from your app";
}

productEl.addEventListener("change", updateCodeFieldForProduct);
updateCodeFieldForProduct();

function setStatus(type, message) {
  statusEl.className = `status ${type}`;
  statusEl.textContent = message;
  statusEl.classList.remove("hidden");
}

function clearStatus() {
  statusEl.classList.add("hidden");
}

function setLoading(loading) {
  btnCheck.disabled = loading;
  btnActivate.disabled = loading;
}

function setServiceHealth(state, text) {
  serviceHealthEl.className = `service-health ${state}`;
  healthTextEl.textContent = text;
}

function turnstileEnabled() {
  return !!TURNSTILE_SITE_KEY;
}

function resetTurnstile() {
  if (!turnstileEnabled() || turnstileWidgetId === null || !window.turnstile) return;
  turnstileToken = "";
  try {
    window.turnstile.reset(turnstileWidgetId);
  } catch {
    // ignore reset errors
  }
}

window.onTurnstileLoad = function onTurnstileLoad() {
  if (!turnstileEnabled() || !turnstileWidgetEl) return;

  turnstileWidgetEl.setAttribute("aria-hidden", "false");
  turnstileWidgetId = window.turnstile.render(turnstileWidgetEl, {
    sitekey: TURNSTILE_SITE_KEY,
    theme: "dark",
    callback(token) {
      turnstileToken = token;
    },
    "expired-callback"() {
      turnstileToken = "";
    },
    "error-callback"() {
      turnstileToken = "";
    },
  });
};

if (turnstileEnabled()) {
  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad";
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
}

async function refreshBrowserChallenge() {
  if (!API_BASE || turnstileEnabled()) {
    browserChallengeId = "";
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/api/v1/challenge`, { method: "GET" });
    const data = await res.json();
    if (data.status === "success" && data.challengeId) {
      browserChallengeId = data.challengeId;
    } else {
      browserChallengeId = "";
    }
  } catch {
    browserChallengeId = "";
  }
}

function requireBrowserProtection() {
  if (turnstileEnabled()) {
    if (turnstileToken) return true;
    setStatus("error", "Please complete the security check below, then try again.");
    return false;
  }
  if (browserChallengeId) return true;
  setStatus("error", "Security challenge not ready. Refresh the page and try again.");
  return false;
}

async function refreshServiceHealth() {
  if (!API_BASE) {
    setServiceHealth("down", "Activation service: Not configured");
    btnCheck.disabled = true;
    btnActivate.disabled = true;
    return;
  }

  setServiceHealth("checking", "Checking activation service...");

  try {
    const res = await fetch(`${API_BASE}/api/v1/health`, { method: "GET" });
    const data = await res.json();

    if (data.status === "up" && data.ready) {
      setServiceHealth("up", "Activation service: UP — Ready to activate");
      btnCheck.disabled = false;
      btnActivate.disabled = false;
      await refreshBrowserChallenge();
    } else if (data.status === "down") {
      setServiceHealth("down", "Activation service: DOWN — Try again later");
      btnCheck.disabled = true;
      btnActivate.disabled = true;
    } else {
      setServiceHealth("down", "Activation service: Unavailable");
      btnCheck.disabled = true;
      btnActivate.disabled = true;
    }
  } catch {
    setServiceHealth("down", "Activation service: OFFLINE");
    btnCheck.disabled = true;
    btnActivate.disabled = true;
  }
}

function ensureApi() {
  if (!API_BASE) {
    setStatus("error", "Activation service is not available right now. Please try again later.");
    return false;
  }
  return true;
}

async function apiCall(endpoint, body) {
  const payload = { ...body };
  if (turnstileEnabled() && turnstileToken) {
    payload.turnstileToken = turnstileToken;
  } else if (browserChallengeId) {
    payload.challengeId = browserChallengeId;
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("Invalid response from server.");
  }

  return { res, data };
}

btnCheck.addEventListener("click", async () => {
  if (!ensureApi() || !requireBrowserProtection()) return;

  const key = keyEl.value.trim();
  if (!key) {
    setStatus("error", "Please enter a key to check.");
    return;
  }

  clearStatus();
  setLoading(true);

  try {
    const { res, data } = await apiCall("/api/v1/check-key", {
      product: productEl.value,
      key,
    });

    if (data.status === "valid") {
      setStatus("success", "Key is valid and not yet used.");
    } else if (data.status === "used") {
      setStatus("info", `Key was already registered.\nDate used (PH time): ${data.datePH || "unknown"}`);
    } else if (data.status === "not_found") {
      setStatus("error", "Key not found in database.");
    } else if (data.status === "rate_limited") {
      const mins = Math.ceil((data.retryAfter || 300) / 60);
      setStatus("error", `Too many requests. Wait about ${mins} minute(s).`);
    } else {
      setStatus("error", data.message || `Request failed (${res.status}).`);
    }
  } catch (err) {
    setStatus("error", err.message || "Network error.");
  } finally {
    setLoading(false);
    resetTurnstile();
    await refreshBrowserChallenge();
  }
});

btnActivate.addEventListener("click", async () => {
  if (!ensureApi() || !requireBrowserProtection()) return;

  const key = keyEl.value.trim();
  const code42 = code42El.value.trim();

  if (!key) {
    setStatus("error", "Please enter your activation key.");
    return;
  }
  if (!code42) {
    setStatus("error", productEl.value === "onetap"
      ? "Please paste your Onetap registration code."
      : "Please paste your 42-character registration code.");
    return;
  }

  const cleanedCode = code42.replace(/\s/g, "");
  if (productEl.value !== "onetap" && cleanedCode.length !== 42) {
    setStatus("error", `Registration code must be exactly 42 characters (you entered ${cleanedCode.length}). Your key was not used.`);
    return;
  }
  if (productEl.value === "onetap" && cleanedCode.length < 10) {
    setStatus("error", "Onetap registration code is too short. Your key was not used.");
    return;
  }

  clearStatus();
  setLoading(true);

  try {
    const { res, data } = await apiCall("/api/v1/activate", {
      product: productEl.value,
      key,
      code42,
    });

    if (data.status === "success") {
      setStatus("success", data.message);
      keyEl.value = "";
      code42El.value = "";
    } else if (data.status === "rate_limited") {
      const mins = Math.ceil((data.retryAfter || 300) / 60);
      setStatus("error", `Too many attempts. Wait about ${mins} minute(s).`);
    } else {
      setStatus("error", data.message || `Activation failed (${res.status}).`);
    }
  } catch (err) {
    setStatus("error", err.message || "Network error.");
  } finally {
    setLoading(false);
    resetTurnstile();
    await refreshBrowserChallenge();
  }
});

refreshServiceHealth();
setInterval(refreshServiceHealth, 60000);
