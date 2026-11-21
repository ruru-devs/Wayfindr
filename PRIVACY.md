# Wayfindr Privacy & Data Protection Architecture

**Version:** 1.0.0  
**Effective Date:** November 2026  
**Guiding Principle:** Local-First, Zero Remote Transmission, User Sovereignty.

---

## 1. Zero Remote Data Transmission Guarantee

**No data ever leaves your browser.**
Wayfindr is architected as an entirely self-contained, local-first browser extension:
- **Zero Remote Network Calls:** Wayfindr does not contact any external servers, APIs, cloud services, telemetry endpoints, or analytics providers.
- **Zero Third-Party Tracking:** No tracking pixels, cookies, behavioral profiling, or logging libraries are included in the extension bundle.
- **Client-Side Search:** The entire search pipeline (lexical analysis, Porter-like stemming, synonym expansion, BM25+ inverted indexing, and re-ranking) runs exclusively on your local CPU inside the browser background Service Worker and Content Script.

---

## 2. Host Permissions Evaluation & Trade-off Analysis

Wayfindr's `manifest.json` specifies `"host_permissions": ["<all_urls>"]`. We evaluated three distinct permission models:

| Permission Model | User Experience (UX) | Crawler Impact | Security & Privacy Posture |
| :--- | :--- | :--- | :--- |
| **Option A: `<all_urls>` (Current Architecture)** | **Seamless.** Instant sub-10ms intent navigation on any visited site upon pressing `Alt+K`. Background index is pre-built without disrupting the user. | Service worker can proactively discover and fetch same-origin subpages, sitemaps, and `llms.txt` in the background. | Requires strict automated safeguards to prevent indexing sensitive pages or domains. Triggers browser install warning. |
| **Option B: Optional Host Permissions** | **High friction.** Every new website displays a modal browser permission prompt ("Allow Wayfindr to read and change data on example.com?"). | Crawler can only index after the user explicitly accepts the prompt for each separate domain. | Minimizes upfront permissions, but significantly degrades the instant keyboard-first UX. |
| **Option C: `activeTab` Only** | **Low install warnings.** No broad host permission requested. | **Severe limitation.** Cannot perform background subpage crawling or index unvisited links; can only read the single page currently open in the active tab. | Completely disables cross-page navigation until the user has already manually visited every subpage. |

### Decision & Defense-in-Depth Guardrails
To preserve instant, effortless site-wide navigation without compromising user privacy, Wayfindr retains Option A with **three automated defense-in-depth safety layers**:
1. **Automated Sensitive URL Blocking:** The crawler automatically detects and aborts crawling on paths matching authentication (`/login`, `/signup`, `/auth`, `/oauth`, `/sso`, `/password`, `/reset-password`), banking and commerce (`/checkout`, `/cart`, `/billing`, `/payment`, `/bank`, `/wallet`), and administrative portals (`/admin`, `/portal`, `/cpanel`), as well as query strings containing tokens (`token=`, `session_id=`, `api_key=`).
2. **Automated Form & Password Detection:** Before extracting live sections from any web page, the content script inspects the DOM. If password inputs (`input[type="password"]`) or payment card inputs (`autocomplete="cc-number"`) are detected, indexing is instantly bypassed.
3. **Hardcoded Sensitive Domain Exclusions & User Exclusion List:** Social networks, search engines, password managers, and major banking institutions are hardcoded in `BLOCKED_DOMAINS`. Users can also add custom domains to `wayfindr_excluded_domains` or toggle the extension off per-site via the popup.

---

## 3. What Data Is Extracted

Wayfindr extracts **only public textual and structural landmarks** necessary for search and section navigation:
- Page title (`<title>`) and canonical URL (`window.location.href`).
- Heading hierarchy text (`<h1>`, `<h2>`, `<h3>`, `<h4>`, `<h5>`, `<h6>`).
- Plain text summaries of content sections (trimmed to a maximum of 300 characters).
- Target anchor IDs (`id` attributes) or computed W3C Scroll-to-Text Fragment selectors (`#:~:text=...`).
- Public action labels (e.g. navigation buttons, pricing tier tags).

### What Is NEVER Extracted:
- Password inputs, login credentials, or security question fields.
- Credit card numbers, CVVs, or billing addresses.
- User cookies, local session tokens, JWTs, or local storage data.
- Personal form inputs (textareas, comments, messages, or unsubmitted form drafts).

---

## 4. Where and How Data Is Stored

- **Storage Location:** All indexed data is serialized as JSON and stored in the browser's sandboxed `chrome.storage.local`.
- **Key Namespacing:** Storage entries are isolated per domain under the keys `wayfindr_${domain}` and `wayfindr_state_${domain}`.
- **Storage Quota & Memory Footprint:** Wayfindr operates under strict storage budgets (~10MB maximum per domain; typical site indices require less than 50KB to 200KB).
- **Cache Retention (TTL):** Indices persist for a default Time-To-Live (TTL) of 24 hours. Upon expiration, the index is marked `STALE` and lazily refreshed in the background.

---

## 5. User Control & Data Deletion

You have complete authority over your indexed data:
1. **Per-Domain Disable:** Click the Wayfindr extension icon in your browser toolbar and toggle the **"Active on this site"** switch off. Wayfindr will immediately cease indexing or listening for shortcuts on that domain.
2. **Clear Index for Site:** Click **"🗑️ Clear Index for Site"** in the extension popup to instantly purge all cached sections, BM25 indices, and state records for the current domain.
3. **Complete Purge:** Clearing your browser's extension storage or uninstalling Wayfindr immediately and permanently deletes all indexed data across all domains.
