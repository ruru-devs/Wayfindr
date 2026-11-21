(() => {
  // src/engine/url_utils.ts
  var SENSITIVE_PATH_PATTERNS = [
    // Auth & Account
    /\b(?:login|signin|sign-in|signup|sign-up|register|logout|auth|oauth|sso|saml)\b/i,
    /\b(?:password|passwd|reset-password|forgot-password|change-password)\b/i,
    /\b(?:account|my-account|profile|settings|security|user-profile)\b/i,
    // Banking & Financial & Payments
    /\b(?:checkout|cart|basket|billing|payment|pay|invoice|receipt)\b/i,
    /\b(?:bank|banking|wallet|fund|transfer|tax|salary|payroll)\b/i,
    // Administrative & Portals
    /\b(?:admin|administrator|moderator|dashboard|portal|cpanel|wp-admin)\b/i
  ];
  var SENSITIVE_QUERY_PATTERNS = [
    /(?:token|auth_token|access_token|refresh_token|api_key|secret|password|passwd|session|session_id|jwt|cvv|ccv|credit_card)=/i
  ];
  function isSensitiveUrl(url) {
    if (!url || typeof url !== "string") return false;
    try {
      const parsed = new URL(url, "http://localhost");
      const path = parsed.pathname.toLowerCase();
      const search = parsed.search.toLowerCase();
      for (const pattern of SENSITIVE_PATH_PATTERNS) {
        if (pattern.test(path)) {
          return true;
        }
      }
      for (const pattern of SENSITIVE_QUERY_PATTERNS) {
        if (pattern.test(search)) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }
  function isSafeNavigationUrl(url, baseUrl) {
    if (!url || typeof url !== "string") return false;
    try {
      const base = baseUrl || (typeof window !== "undefined" && window.location?.href ? window.location.href : "http://localhost");
      const parsed = new URL(url, base);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  // src/engine/sectionizer.ts
  function generateDomPath(el) {
    const parts = [];
    let curr = el;
    while (curr && curr.nodeType === 1 && curr.tagName.toLowerCase() !== "body" && curr.tagName.toLowerCase() !== "html") {
      if (curr.id) {
        parts.unshift(`#${curr.id}`);
        break;
      }
      const tag = curr.tagName.toLowerCase();
      const parent = curr.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName.toLowerCase() === tag);
        if (siblings.length > 1) {
          const index = siblings.indexOf(curr) + 1;
          parts.unshift(`${tag}:nth-of-type(${index})`);
        } else {
          parts.unshift(tag);
        }
      } else {
        parts.unshift(tag);
      }
      curr = curr.parentElement;
    }
    return parts.join(" > ");
  }
  function generateSlug(text) {
    return text.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
  }
  function generateTextFragment(text) {
    const words = text.trim().split(/\s+/).slice(0, 6).join(" ");
    return words ? `#:~:text=${encodeURIComponent(words)}` : "";
  }
  function extractSectionsFromDoc(doc, pageUrl, pageDocTitle) {
    const sections = [];
    const candidates = [];
    doc.querySelectorAll('nav a[href], header a[href], [role="navigation"] a[href]').forEach((a) => {
      const text = (a.textContent || "").trim().replace(/\s+/g, " ");
      const href = a.getAttribute("href");
      if (text.length >= 2 && text.length <= 60 && href && !href.startsWith("#") && !href.startsWith("javascript:")) {
        try {
          const fullUrl = new URL(href, pageUrl).href;
          sections.push({
            id: `menu_${sections.length + 1}`,
            url: fullUrl,
            pageTitle: `${pageDocTitle} \u203A Navigation`,
            title: text,
            snippet: `Menu link: ${text} on ${pageDocTitle}`,
            actionLabel: "Explore"
          });
        } catch {
        }
      }
    });
    doc.querySelectorAll('section, article, div[id], main, [role="region"], [role="main"]').forEach((el) => {
      if (!el.closest("nav") && !["SCRIPT", "STYLE", "NOSCRIPT", "SVG"].includes(el.tagName)) {
        candidates.push(el);
      }
    });
    if (candidates.length < 3) {
      doc.querySelectorAll("h1, h2, h3").forEach((h) => {
        const parent = h.parentElement;
        if (parent && !candidates.includes(parent) && !parent.closest("nav")) {
          candidates.push(parent);
        }
      });
    }
    const filteredCandidates = [];
    for (let i = 0; i < candidates.length; i++) {
      const a = candidates[i];
      const children = candidates.filter((b) => a !== b && a.contains(b));
      if (children.length > 0) {
        let directText = a.textContent || "";
        for (const child of children) {
          directText = directText.replace(child.textContent || "", "");
        }
        directText = directText.trim().replace(/\s+/g, " ");
        if (directText.length < 80) {
          continue;
        }
      }
      filteredCandidates.push(a);
    }
    let idx = 0;
    for (const block of filteredCandidates) {
      const text = (block.textContent || "").trim().replace(/\s+/g, " ");
      if (text.length < 25) continue;
      const heading = block.querySelector("h1, h2, h3, h4, h5");
      let title = (heading?.textContent || "").trim();
      if (!title) {
        const strong = block.querySelector("strong, b");
        title = (strong?.textContent || "").trim() || text.split(/\s+/).slice(0, 6).join(" ");
      }
      const nativeId = block.id || heading?.id || "";
      const generatedSlug = title ? generateSlug(title) : "";
      const anchorId = nativeId || generatedSlug || void 0;
      const hasUsableAnchor = Boolean(nativeId || generatedSlug);
      const landingConfidence = nativeId ? 1 : generatedSlug ? 0.85 : 0.6;
      const locator = generateDomPath(block);
      const textFragment = generateTextFragment(title || text);
      const actionEl = block.querySelector("a, button");
      let actionLabel = (actionEl?.textContent || "").trim();
      let actionUrl = actionEl?.getAttribute("href") || void 0;
      if (actionUrl && !actionUrl.startsWith("http") && !actionUrl.startsWith("#")) {
        try {
          actionUrl = new URL(actionUrl, pageUrl).href;
        } catch {
        }
      }
      const priceMatch = text.match(/(?:₹|\$|USD|INR|EUR|Rs\.?)\s*([\d,]+(?:\.\d+)?)/i);
      const timingsMatch = text.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)\s*-\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))/);
      idx++;
      sections.push({
        id: `sec_${idx}_${nativeId || generatedSlug || "block"}`,
        url: pageUrl,
        pageTitle: pageDocTitle || "Page",
        anchorId,
        locator,
        textFragment,
        hasUsableAnchor,
        landingConfidence,
        title: title.slice(0, 100),
        snippet: text.slice(0, 200).replace(/\s+/g, " "),
        actionLabel: actionLabel && actionLabel.length < 30 ? actionLabel : void 0,
        actionUrl,
        metadata: {
          price: priceMatch ? priceMatch[0] : void 0,
          timings: timingsMatch ? timingsMatch[0] : void 0
        }
      });
    }
    try {
      const jsonLdScripts = doc.querySelectorAll('script[type="application/ld+json"]');
      jsonLdScripts.forEach((script) => {
        const parsed = JSON.parse(script.textContent || "{}");
        const items = Array.isArray(parsed) ? parsed : parsed["@graph"] || [parsed];
        for (const item of items) {
          if (!item || !item["@type"]) continue;
          const schemaType = String(item["@type"]);
          const schemaName = item.name || item.headline || item.title || "";
          const schemaDesc = item.description || item.articleBody || "";
          if (schemaName) {
            idx++;
            sections.push({
              id: `sec_schema_${idx}`,
              url: pageUrl,
              pageTitle: `${schemaType}: ${schemaName}`,
              title: schemaName.slice(0, 100),
              snippet: (schemaDesc || `${schemaType} on ${pageDocTitle}`).slice(0, 200),
              metadata: {
                schemaType,
                price: item.price || item.offers?.price,
                timings: item.openingHours || item.openingHoursSpecification ? JSON.stringify(item.openingHours || item.openingHoursSpecification) : void 0
              }
            });
          }
        }
      });
    } catch {
    }
    return sections;
  }

  // src/content/content_script.ts
  function checkAndHighlightTarget() {
    const hash = window.location.hash ? window.location.hash.substring(1) : "";
    if (hash) {
      setTimeout(() => {
        let target = document.getElementById(hash) || document.querySelector(`[name="${hash}"]`);
        if (!target && !hash.startsWith(":~:text=")) {
          const headings = document.querySelectorAll("h1, h2, h3, h4, h5, strong");
          for (const h of headings) {
            const slug = (h.textContent || "").toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-");
            if (slug && slug.includes(hash.toLowerCase())) {
              target = h.closest("section, article, div") || h;
              break;
            }
          }
        }
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          target.classList.remove("wayfindr-pulse-target");
          void target.offsetWidth;
          target.classList.add("wayfindr-pulse-target");
        }
      }, 350);
    }
  }
  var styleTag = document.createElement("style");
  styleTag.id = "wayfindr-global-styles";
  styleTag.textContent = `
  @keyframes wayfindrGlow {
    0% { outline: 4px solid #38bdf8; background-color: rgba(56, 189, 248, 0.28); }
    50% { outline: 6px solid #0284c7; background-color: rgba(2, 132, 199, 0.38); }
    100% { outline: 4px solid transparent; background-color: transparent; }
  }
  .wayfindr-pulse-target {
    animation: wayfindrGlow 2.8s cubic-bezier(0.16, 1, 0.3, 1) !important;
    scroll-margin-top: 100px !important;
  }
`;
  document.head.appendChild(styleTag);
  async function isDomainEnabled() {
    try {
      const domain = window.location.hostname;
      const res = await chrome.storage.local.get([`wayfindr_disabled_${domain}`]);
      return !res[`wayfindr_disabled_${domain}`];
    } catch {
      return true;
    }
  }
  function isSensitivePage(doc) {
    if (isSensitiveUrl(window.location.href)) {
      return true;
    }
    try {
      const passwordInput = doc.querySelector('input[type="password"]');
      if (passwordInput) return true;
      const sensitiveInputs = doc.querySelectorAll('input[autocomplete*="password"], input[autocomplete*="cc-number"], input[autocomplete*="credit-card"]');
      if (sensitiveInputs.length > 0) return true;
    } catch {
    }
    return false;
  }
  checkAndHighlightTarget();
  async function extractAndSendLiveDOM() {
    try {
      const enabled = await isDomainEnabled();
      if (!enabled) return;
      if (isSensitivePage(document)) {
        console.log("[Wayfindr Privacy] Sensitive page/form detected. Skipping indexing for privacy.");
        return;
      }
      const liveSections = extractSectionsFromDoc(document, window.location.href, document.title);
      chrome.runtime.sendMessage({
        action: "PAGE_LOADED",
        url: window.location.href,
        liveSections
      });
    } catch (err) {
      chrome.runtime.sendMessage({ action: "PAGE_LOADED", url: window.location.href });
    }
  }
  extractAndSendLiveDOM();
  setTimeout(extractAndSendLiveDOM, 1200);
  var host = document.createElement("div");
  host.id = "wayfindr-extension-root";
  var shadow = host.attachShadow({ mode: "open" });
  document.documentElement.appendChild(host);
  var lastTrackedUrl = window.location.href;
  var domMutationTimeout = null;
  function onLocationChange() {
    if (window.location.href !== lastTrackedUrl) {
      lastTrackedUrl = window.location.href;
      checkAndHighlightTarget();
      extractAndSendLiveDOM();
    }
  }
  if (typeof history !== "undefined") {
    const nativePushState = history.pushState;
    if (typeof nativePushState === "function") {
      history.pushState = function(...args) {
        const res = nativePushState.apply(this, args);
        onLocationChange();
        return res;
      };
    }
    const nativeReplaceState = history.replaceState;
    if (typeof nativeReplaceState === "function") {
      history.replaceState = function(...args) {
        const res = nativeReplaceState.apply(this, args);
        onLocationChange();
        return res;
      };
    }
  }
  window.addEventListener("popstate", onLocationChange);
  if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
    const domObserver = new MutationObserver((mutations) => {
      const hasExternalChanges = mutations.some((m) => !host.contains(m.target));
      if (!hasExternalChanges) return;
      if (domMutationTimeout) clearTimeout(domMutationTimeout);
      domMutationTimeout = setTimeout(() => {
        extractAndSendLiveDOM();
      }, 800);
    });
    const observeTarget = document.body || document.documentElement;
    if (observeTarget) {
      domObserver.observe(observeTarget, { childList: true, subtree: true });
    }
  }
  var shadowStyle = document.createElement("style");
  shadowStyle.textContent = `
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.65);
    backdrop-filter: blur(5px);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 12vh;
    z-index: 2147483647;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.18s ease;
  }
  .backdrop.open {
    opacity: 1;
    pointer-events: auto;
  }
  .modal {
    width: 100%;
    max-width: 650px;
    background: #ffffff;
    border-radius: 14px;
    box-shadow: 0 25px 50px -12px rgba(0,0,0,0.45);
    border: 1px solid #e2e8f0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    animation: slideIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes slideIn {
    from { transform: translateY(-10px) scale(0.98); }
    to { transform: translateY(0) scale(1); }
  }
  .search-bar {
    display: flex;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid #f1f5f9;
    gap: 12px;
  }
  .search-input {
    flex: 1;
    border: none;
    outline: none;
    font-size: 16px;
    color: #0f172a;
    background: transparent;
  }
  .badge {
    background: #f1f5f9;
    color: #64748b;
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
  }
  .results {
    max-height: 400px;
    overflow-y: auto;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    border-radius: 10px;
    cursor: pointer;
    background: #ffffff;
    border: 1px solid #f1f5f9;
    transition: all 0.12s ease;
  }
  .item:hover, .item.selected {
    background: #f0f9ff;
    border-color: #38bdf8;
    transform: translateX(2px);
  }
  .item.selected {
    outline: 2px solid #0284c7;
    outline-offset: -1px;
  }
  .item-main {
    flex: 1;
    padding-right: 12px;
  }
  .item-page {
    font-size: 11px;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
    margin-bottom: 2px;
  }
  .item-title {
    font-weight: 600;
    font-size: 14.5px;
    color: #0f172a;
  }
  .item-snippet {
    font-size: 12.5px;
    color: #64748b;
    margin-top: 2px;
  }
  .item-meta {
    font-size: 11.5px;
    font-weight: 600;
    color: #0284c7;
    margin-top: 4px;
  }
  .action-badge {
    background: #0284c7;
    color: #ffffff;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
  }
  .footer {
    padding: 10px 18px;
    border-top: 1px solid #f1f5f9;
    display: flex;
    justify-content: space-between;
    font-size: 11.5px;
    color: #94a3b8;
    background: #fafafa;
  }
`;
  shadow.appendChild(shadowStyle);
  var backdrop = document.createElement("div");
  backdrop.className = "backdrop";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  backdrop.setAttribute("aria-label", "Wayfindr site intent navigation");
  backdrop.innerHTML = `
  <div class="modal">
    <div class="search-bar">
      <svg width="18" height="18" fill="none" stroke="#64748b" stroke-width="2" viewBox="0 0 24 24">
        <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
      </svg>
      <input type="text" class="search-input" 
        role="combobox"
        aria-autocomplete="list"
        aria-expanded="false"
        aria-controls="wayfindr-results"
        aria-activedescendant=""
        placeholder="Type intent (e.g. 'return policy', 'dr sharma timings', 'specs')..." />
      <span class="badge">ESC</span>
    </div>
    <div class="results" id="wayfindr-results" role="listbox" aria-label="Navigation destinations">
      <div style="padding: 16px; text-align: center; color: #94a3b8; font-size: 13px;">
        Type an instruction or intent to instantly cross-navigate this website...
      </div>
    </div>
    <div class="footer">
      <span>\u26A1 <strong>Wayfindr</strong> Extension Engine</span>
      <span id="footer-status">Sub-10ms Cross-Page Jump</span>
    </div>
  </div>
`;
  shadow.appendChild(backdrop);
  var searchInput = backdrop.querySelector(".search-input");
  var resultsContainer = backdrop.querySelector(".results");
  var previousFocusedElement = null;
  var selectedIndex = -1;
  var currentResultElements = [];
  var latestRequestId = 0;
  function updateSelection() {
    currentResultElements.forEach((el, idx) => {
      if (idx === selectedIndex) {
        el.classList.add("selected");
        el.setAttribute("aria-selected", "true");
        searchInput.setAttribute("aria-activedescendant", el.id);
        el.scrollIntoView({ block: "nearest" });
      } else {
        el.classList.remove("selected");
        el.setAttribute("aria-selected", "false");
      }
    });
    if (selectedIndex === -1) {
      searchInput.setAttribute("aria-activedescendant", "");
    }
  }
  function updateIndexingStatus(state, count) {
    const statusEl = backdrop.querySelector("#footer-status");
    if (!statusEl) return;
    if (state === "INDEXING") {
      statusEl.textContent = "\u26A1 Indexing site in background...";
    } else if (state === "REINDEXING") {
      statusEl.textContent = "\u{1F504} Refreshing site index...";
    } else if (state === "STALE") {
      statusEl.textContent = `\u26A0\uFE0F Index stale (${count || 0} sections)`;
    } else if (state === "READY") {
      statusEl.textContent = `\u2713 Ready (${count || 0} sections)`;
    } else {
      statusEl.textContent = "Sub-10ms Cross-Page Jump";
    }
  }
  async function openPalette() {
    const enabled = await isDomainEnabled();
    if (!enabled) {
      console.log("[Wayfindr] Extension is disabled on this domain.");
      return;
    }
    previousFocusedElement = document.activeElement;
    backdrop.classList.add("open");
    searchInput.setAttribute("aria-expanded", "true");
    searchInput.focus();
    try {
      chrome.runtime.sendMessage({ action: "GET_STATE", url: window.location.href }, (resp) => {
        if (resp) updateIndexingStatus(resp.state, resp.count);
      });
    } catch {
    }
  }
  function closePalette() {
    backdrop.classList.remove("open");
    searchInput.setAttribute("aria-expanded", "false");
    searchInput.setAttribute("aria-activedescendant", "");
    selectedIndex = -1;
    updateSelection();
    if (previousFocusedElement && typeof previousFocusedElement.focus === "function") {
      previousFocusedElement.focus();
    }
  }
  function togglePalette() {
    backdrop.classList.contains("open") ? closePalette() : openPalette();
  }
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (currentResultElements.length > 0) {
        selectedIndex = (selectedIndex + 1) % currentResultElements.length;
        updateSelection();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (currentResultElements.length > 0) {
        selectedIndex = (selectedIndex - 1 + currentResultElements.length) % currentResultElements.length;
        updateSelection();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < currentResultElements.length) {
        currentResultElements[selectedIndex].click();
      } else if (currentResultElements.length > 0) {
        currentResultElements[0].click();
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      searchInput.focus();
    }
  });
  chrome.runtime.onMessage.addListener((msg, sender, sendResp) => {
    if (msg.action === "TOGGLE_PALETTE") {
      togglePalette();
      sendResp({ status: "OK" });
    }
    return false;
  });
  window.addEventListener("keydown", (e) => {
    const isK = e.key.toLowerCase() === "k" || e.code === "KeyK";
    const isAlt = e.altKey;
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    if (isK && (isAlt || isCtrlOrCmd)) {
      e.preventDefault();
      e.stopPropagation();
      togglePalette();
      return;
    }
    if (e.key === "Escape" && backdrop.classList.contains("open")) {
      e.preventDefault();
      closePalette();
    }
  }, true);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closePalette();
  });
  var debounce = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(debounce);
    const q = searchInput.value.trim();
    if (!q) {
      resultsContainer.textContent = "";
      const hint = document.createElement("div");
      hint.style.cssText = "padding: 16px; text-align: center; color: #94a3b8; font-size: 13px;";
      hint.textContent = "Type an instruction or intent to instantly cross-navigate this website...";
      resultsContainer.appendChild(hint);
      currentResultElements = [];
      selectedIndex = -1;
      updateSelection();
      return;
    }
    const reqId = ++latestRequestId;
    debounce = setTimeout(() => {
      chrome.runtime.sendMessage({ action: "SEARCH_QUERY", query: q, url: window.location.href }, (resp) => {
        if (reqId !== latestRequestId) return;
        if (resp?.status) updateIndexingStatus(resp.status, resp.indexedSectionsCount);
        renderResults(resp?.results || []);
      });
    }, 100);
  });
  function renderResults(results) {
    resultsContainer.textContent = "";
    currentResultElements = [];
    selectedIndex = -1;
    if (!results.length) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding: 24px; text-align: center; color: #64748b; font-size: 13.5px;";
      empty.textContent = "No destination matching your search was found across this website.";
      resultsContainer.appendChild(empty);
      updateSelection();
      return;
    }
    results.forEach((res, idx) => {
      const el = document.createElement("div");
      el.className = "item";
      el.id = `wayfindr-opt-${idx}`;
      el.setAttribute("role", "option");
      el.setAttribute("aria-selected", "false");
      const itemMain = document.createElement("div");
      itemMain.className = "item-main";
      const itemPage = document.createElement("div");
      itemPage.className = "item-page";
      itemPage.textContent = `${res.isCurrentPage ? "Current Page" : "Cross-Page Link"} \u203A ${res.pageTitle || ""}`;
      itemMain.appendChild(itemPage);
      const itemTitle = document.createElement("div");
      itemTitle.className = "item-title";
      itemTitle.textContent = res.title || "";
      itemMain.appendChild(itemTitle);
      const itemSnippet = document.createElement("div");
      itemSnippet.className = "item-snippet";
      itemSnippet.textContent = res.snippet || "";
      itemMain.appendChild(itemSnippet);
      if (res.metadata?.price) {
        const itemPrice = document.createElement("div");
        itemPrice.className = "item-meta";
        itemPrice.textContent = `\u{1F4B0} ${res.metadata.price}`;
        itemMain.appendChild(itemPrice);
      }
      if (res.metadata?.timings) {
        const itemTimings = document.createElement("div");
        itemTimings.className = "item-meta";
        itemTimings.textContent = `\u{1F552} ${res.metadata.timings}`;
        itemMain.appendChild(itemTimings);
      }
      if (res.whyMatched) {
        const itemWhy = document.createElement("div");
        itemWhy.className = "item-why";
        itemWhy.style.cssText = "font-size: 11px; color: #0284c7; margin-top: 3px; font-weight: 500;";
        itemWhy.textContent = `\u{1F4A1} ${res.whyMatched}`;
        itemMain.appendChild(itemWhy);
      }
      el.appendChild(itemMain);
      const actionBadge = document.createElement("div");
      actionBadge.className = "action-badge";
      actionBadge.textContent = res.isCurrentPage ? "Jump" : "Navigate";
      el.appendChild(actionBadge);
      el.addEventListener("click", () => {
        closePalette();
        if (res.isCurrentPage) {
          let target = null;
          if (res.anchorId) {
            target = document.getElementById(res.anchorId) || document.querySelector(`[name="${res.anchorId}"]`);
          }
          if (!target && res.locator) {
            try {
              target = document.querySelector(res.locator);
            } catch {
            }
          }
          if (!target && res.title) {
            const headings = document.querySelectorAll("h1, h2, h3, h4, h5");
            for (const h of headings) {
              if ((h.textContent || "").trim() === res.title) {
                target = h.closest("section, article, div") || h;
                break;
              }
            }
          }
          if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "center" });
            target.classList.remove("wayfindr-pulse-target");
            void target.offsetWidth;
            target.classList.add("wayfindr-pulse-target");
            return;
          }
        }
        let navUrl = res.targetUrl;
        if (!navUrl.includes("#")) {
          if (res.anchorId) {
            navUrl = `${navUrl}#${res.anchorId}`;
          } else if (res.textFragment) {
            navUrl = `${navUrl}${res.textFragment}`;
          }
        }
        if (isSafeNavigationUrl(navUrl)) {
          window.location.href = navUrl;
        } else {
          console.warn("[Wayfindr] Blocked navigation to unsafe URL scheme:", navUrl);
        }
      });
      currentResultElements.push(el);
      resultsContainer.appendChild(el);
    });
    if (currentResultElements.length > 0) {
      selectedIndex = 0;
      updateSelection();
    }
  }
})();
