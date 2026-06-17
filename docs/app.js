const productEl = document.getElementById("product");
const keyEl = document.getElementById("key");
const code42El = document.getElementById("code42");
const btnCheck = document.getElementById("btnCheck");
const btnActivate = document.getElementById("btnActivate");
const statusEl = document.getElementById("status");
const apiUrlEl = document.getElementById("apiUrl");

const API_BASE = (window.ACTIVATE_API_BASE || "").replace(/\/$/, "");

apiUrlEl.textContent = API_BASE || "(set config.js after Worker deploy)";

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

function ensureApi() {
  if (!API_BASE) {
    setStatus("error", "API URL not configured. Edit website/config.js first.");
    return false;
  }
  return true;
}

async function apiCall(endpoint, body) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
  if (!ensureApi()) return;

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
      setStatus("success", "✅ Key is valid and not yet used.");
    } else if (data.status === "used") {
      setStatus("info", `❌ Key was already registered.\nDate used (PH time): ${data.datePH || "unknown"}`);
    } else if (data.status === "not_found") {
      setStatus("error", "❌ Key not found in database.");
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
  }
});

btnActivate.addEventListener("click", async () => {
  if (!ensureApi()) return;

  const key = keyEl.value.trim();
  const code42 = code42El.value.trim();

  if (!key) {
    setStatus("error", "Please enter your activation key.");
    return;
  }
  if (!code42) {
    setStatus("error", "Please paste your 42-character registration code.");
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
  }
});
