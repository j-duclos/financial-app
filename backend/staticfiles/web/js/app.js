(function () {
  "use strict";

  const PLAID_LINK_TOKEN_KEY = "budget-app.plaid.link_token_pending";

  function getCsrfToken() {
    const el = document.querySelector("[name=csrfmiddlewaretoken]");
    return el ? el.value : "";
  }

  function persistLinkToken(token) {
    try {
      sessionStorage.setItem(PLAID_LINK_TOKEN_KEY, token);
      localStorage.setItem(PLAID_LINK_TOKEN_KEY, token);
    } catch (_) {}
  }

  function readLinkToken() {
    try {
      return sessionStorage.getItem(PLAID_LINK_TOKEN_KEY) || localStorage.getItem(PLAID_LINK_TOKEN_KEY);
    } catch (_) {
      return null;
    }
  }

  function clearLinkToken() {
    try {
      sessionStorage.removeItem(PLAID_LINK_TOKEN_KEY);
      localStorage.removeItem(PLAID_LINK_TOKEN_KEY);
    } catch (_) {}
  }

  function stripOAuthParams() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("oauth_state_id")) return;
    url.searchParams.delete("oauth_state_id");
    const q = url.searchParams.toString();
    window.history.replaceState({}, "", url.pathname + (q ? "?" + q : "") + url.hash);
  }

  function showError(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.hidden = !msg;
  }

  async function postForm(url, data) {
    const body = new URLSearchParams(data);
    body.set("csrfmiddlewaretoken", getCsrfToken());
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      credentials: "same-origin",
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const detail = json.detail || json.error_message || JSON.stringify(json);
      throw new Error(typeof detail === "string" ? detail : "Request failed");
    }
    return json;
  }

  function initPlaidLink(config) {
    const errorEl = document.getElementById("plaid-error");
    const statusEl = document.getElementById("plaid-status");
    const connectBtn = document.getElementById("plaid-connect-btn");

    if (!config.plaidConfigured) {
      showError(errorEl, "Plaid is not configured on the server (PLAID_CLIENT_ID / PLAID_SECRET).");
      if (connectBtn) connectBtn.disabled = true;
      return;
    }

    if (!config.householdId) {
      showError(errorEl, "Set a default household for your user (Django admin → User profiles) before linking a bank.");
      if (connectBtn) connectBtn.disabled = true;
      return;
    }

    let linkToken = null;
    let receivedRedirectUri = null;

    function openLink() {
      if (!linkToken || !window.Plaid) return;
      const handler = window.Plaid.create({
        token: linkToken,
        receivedRedirectUri: receivedRedirectUri || undefined,
        onSuccess: async (publicToken) => {
          try {
            await postForm(config.exchangeUrl, {
              public_token: publicToken,
            });
            clearLinkToken();
            stripOAuthParams();
            if (statusEl) statusEl.textContent = "Bank linked successfully.";
            if (config.oauthReturn && config.redirectAfter) {
              window.location.href = config.redirectAfter;
            } else {
              window.location.reload();
            }
          } catch (e) {
            showError(errorEl, e.message);
          }
        },
        onExit: (err) => {
          if (err && (err.display_message || err.error_message)) {
            showError(errorEl, [err.display_message, err.error_message].filter(Boolean).join(" — "));
          }
          linkToken = null;
          receivedRedirectUri = null;
        },
      });
      handler.open();
    }

    async function startLink() {
      showError(errorEl, "");
      if (connectBtn) connectBtn.disabled = true;
      try {
        const data = await postForm(config.linkTokenUrl, {
          redirect_uri: config.redirectUri,
        });
        linkToken = data.link_token;
        persistLinkToken(linkToken);
        openLink();
      } catch (e) {
        showError(errorEl, e.message);
      } finally {
        if (connectBtn) connectBtn.disabled = false;
      }
    }

    if (connectBtn) {
      connectBtn.addEventListener("click", () => startLink());
    }

    const params = new URLSearchParams(window.location.search);
    if (params.has("oauth_state_id") && config.oauthReturn) {
      const stored = readLinkToken();
      if (!stored) {
        showError(errorEl, "Could not resume bank sign-in (missing session). Try Connect Bank again.");
        stripOAuthParams();
        return;
      }
      linkToken = stored;
      receivedRedirectUri = window.location.href;
      openLink();
    }
  }

  function initReconcileCalc() {
    const form = document.getElementById("reconcile-form");
    if (!form) return;
    const opening = parseFloat(form.dataset.opening || "0");
    const bank = parseFloat(form.dataset.bank || "0");
    const calcEl = document.getElementById("calc-balance");
    const diffEl = document.getElementById("diff-balance");

    function recalc() {
      let sum = opening;
      form.querySelectorAll('input[name="checked"]:checked').forEach((cb) => {
        sum += parseFloat(cb.dataset.amount || "0");
      });
      if (calcEl) calcEl.textContent = sum.toFixed(2);
      if (diffEl) {
        const diff = bank - sum;
        diffEl.textContent = diff.toFixed(2);
        diffEl.className = Math.abs(diff) <= 0.01 ? "positive" : "negative";
      }
    }

    form.querySelectorAll('input[name="checked"]').forEach((cb) => {
      cb.addEventListener("change", recalc);
    });
    recalc();
  }

  window.BudgetWeb = { initPlaidLink, initReconcileCalc };
})();
