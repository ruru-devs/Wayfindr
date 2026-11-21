import { SearchResultItem } from '../engine/types';
import { extractSectionsFromDoc } from '../engine/sectionizer';
import { isSafeNavigationUrl } from '../engine/url_utils';

/**
 * Content Script:
 * 1. Notifies background worker on page load to initiate background crawl.
 * 2. Injects isolated Shadow DOM search palette on Ctrl+K.
 * 3. Handles cross-page landing highlights with smooth scrolling & pulsing animation.
 */

// Highlight target element on cross-page landing
function checkAndHighlightTarget() {
  const hash = window.location.hash ? window.location.hash.substring(1) : '';
  if (hash) {
    setTimeout(() => {
      let target = document.getElementById(hash) || document.querySelector(`[name="${hash}"]`);
      if (!target && !hash.startsWith(':~:text=')) {
        // Fallback: search headings by slug
        const headings = document.querySelectorAll('h1, h2, h3, h4, h5, strong');
        for (const h of headings) {
          const slug = (h.textContent || '').toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-');
          if (slug && slug.includes(hash.toLowerCase())) {
            target = h.closest('section, article, div') || h;
            break;
          }
        }
      }
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.remove('wayfindr-pulse-target');
        void (target as HTMLElement).offsetWidth;
        target.classList.add('wayfindr-pulse-target');
      }
    }, 350);
  }
}

// Global styles for highlight animation
const styleTag = document.createElement('style');
styleTag.id = 'wayfindr-global-styles';
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

// Initialize on page load: Solution A - Extract live DOM sections directly from active tab
checkAndHighlightTarget();

function extractAndSendLiveDOM() {
  try {
    const liveSections = extractSectionsFromDoc(document, window.location.href, document.title);
    chrome.runtime.sendMessage({
      action: 'PAGE_LOADED',
      url: window.location.href,
      liveSections: liveSections
    });
  } catch (err) {
    chrome.runtime.sendMessage({ action: 'PAGE_LOADED', url: window.location.href });
  }
}

// Extract immediately and again after 1.2s to capture client-side hydrated SPA elements (React/Next.js/AEM)
extractAndSendLiveDOM();
setTimeout(extractAndSendLiveDOM, 1200);

// Shadow DOM Overlay for Ctrl+K
const host = document.createElement('div');
host.id = 'wayfindr-extension-root';
const shadow = host.attachShadow({ mode: 'open' });
document.documentElement.appendChild(host);

const shadowStyle = document.createElement('style');
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
  .item:hover {
    background: #f8fafc;
    border-color: #cbd5e1;
    transform: translateX(2px);
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

const backdrop = document.createElement('div');
backdrop.className = 'backdrop';
backdrop.innerHTML = `
  <div class="modal">
    <div class="search-bar">
      <svg width="18" height="18" fill="none" stroke="#64748b" stroke-width="2" viewBox="0 0 24 24">
        <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
      </svg>
      <input type="text" class="search-input" placeholder="Type intent (e.g. 'return policy', 'dr sharma timings', 'specs')..." />
      <span class="badge">ESC</span>
    </div>
    <div class="results">
      <div style="padding: 16px; text-align: center; color: #94a3b8; font-size: 13px;">
        Type an instruction or intent to instantly cross-navigate this website...
      </div>
    </div>
    <div class="footer">
      <span>⚡ <strong>Wayfindr</strong> Extension Engine</span>
      <span id="footer-status">Sub-10ms Cross-Page Jump</span>
    </div>
  </div>
`;
shadow.appendChild(backdrop);

const searchInput = backdrop.querySelector('.search-input') as HTMLInputElement;
const resultsContainer = backdrop.querySelector('.results') as HTMLDivElement;

function updateIndexingStatus(state?: string, count?: number) {
  const statusEl = backdrop.querySelector('#footer-status');
  if (!statusEl) return;

  if (state === 'INDEXING') {
    statusEl.textContent = '⚡ Indexing site in background...';
  } else if (state === 'REINDEXING') {
    statusEl.textContent = '🔄 Refreshing site index...';
  } else if (state === 'STALE') {
    statusEl.textContent = `⚠️ Index stale (${count || 0} sections)`;
  } else if (state === 'READY') {
    statusEl.textContent = `✓ Ready (${count || 0} sections)`;
  } else {
    statusEl.textContent = 'Sub-10ms Cross-Page Jump';
  }
}

function openPalette() {
  backdrop.classList.add('open');
  searchInput.focus();
  try {
    chrome.runtime.sendMessage({ action: 'GET_STATE', url: window.location.href }, (resp) => {
      if (resp) updateIndexingStatus(resp.state, resp.count);
    });
  } catch {}
}

function closePalette() {
  backdrop.classList.remove('open');
}

function togglePalette() {
  backdrop.classList.contains('open') ? closePalette() : openPalette();
}

// 1. Listen for background command (Alt+K or configured in browser)
chrome.runtime.onMessage.addListener((msg, sender, sendResp) => {
  if (msg.action === 'TOGGLE_PALETTE') {
    togglePalette();
    sendResp({ status: 'OK' });
  }
  return false;
});

// 2. Direct DOM key bindings (Capture phase to precede browser/page handlers)
// Dedicated hotkey: Alt+K (and Ctrl+K also supported)
window.addEventListener('keydown', (e) => {
  const isK = e.key.toLowerCase() === 'k' || e.code === 'KeyK';
  const isAlt = e.altKey;
  const isCtrlOrCmd = e.ctrlKey || e.metaKey;

  if (isK && (isAlt || isCtrlOrCmd)) {
    e.preventDefault();
    e.stopPropagation();
    togglePalette();
    return;
  }
  if (e.key === 'Escape' && backdrop.classList.contains('open')) {
    e.preventDefault();
    closePalette();
  }
}, true);

backdrop.addEventListener('click', (e) => {
  if (e.target === backdrop) closePalette();
});

let debounce: any = null;
searchInput.addEventListener('input', () => {
  clearTimeout(debounce);
  const q = searchInput.value.trim();
  if (!q) {
    resultsContainer.textContent = '';
    const hint = document.createElement('div');
    hint.style.cssText = 'padding: 16px; text-align: center; color: #94a3b8; font-size: 13px;';
    hint.textContent = 'Type an instruction or intent to instantly cross-navigate this website...';
    resultsContainer.appendChild(hint);
    return;
  }

  debounce = setTimeout(() => {
    chrome.runtime.sendMessage({ action: 'SEARCH_QUERY', query: q, url: window.location.href }, (resp) => {
      if (resp?.status) updateIndexingStatus(resp.status, resp.indexedSectionsCount);
      renderResults(resp?.results || []);
    });
  }, 100);
});

function renderResults(results: SearchResultItem[]) {
  resultsContainer.textContent = '';
  if (!results.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding: 24px; text-align: center; color: #64748b; font-size: 13.5px;';
    empty.textContent = 'No destination matching your search was found across this website.';
    resultsContainer.appendChild(empty);
    return;
  }

  results.forEach(res => {
    const el = document.createElement('div');
    el.className = 'item';

    const itemMain = document.createElement('div');
    itemMain.className = 'item-main';

    const itemPage = document.createElement('div');
    itemPage.className = 'item-page';
    itemPage.textContent = `${res.isCurrentPage ? 'Current Page' : 'Cross-Page Link'} › ${res.pageTitle || ''}`;
    itemMain.appendChild(itemPage);

    const itemTitle = document.createElement('div');
    itemTitle.className = 'item-title';
    itemTitle.textContent = res.title || '';
    itemMain.appendChild(itemTitle);

    const itemSnippet = document.createElement('div');
    itemSnippet.className = 'item-snippet';
    itemSnippet.textContent = res.snippet || '';
    itemMain.appendChild(itemSnippet);

    if (res.metadata?.price) {
      const itemPrice = document.createElement('div');
      itemPrice.className = 'item-meta';
      itemPrice.textContent = `💰 ${res.metadata.price}`;
      itemMain.appendChild(itemPrice);
    }

    if (res.metadata?.timings) {
      const itemTimings = document.createElement('div');
      itemTimings.className = 'item-meta';
      itemTimings.textContent = `🕒 ${res.metadata.timings}`;
      itemMain.appendChild(itemTimings);
    }

    if (res.whyMatched) {
      const itemWhy = document.createElement('div');
      itemWhy.className = 'item-why';
      itemWhy.style.cssText = 'font-size: 11px; color: #0284c7; margin-top: 3px; font-weight: 500;';
      itemWhy.textContent = `💡 ${res.whyMatched}`;
      itemMain.appendChild(itemWhy);
    }

    el.appendChild(itemMain);

    const actionBadge = document.createElement('div');
    actionBadge.className = 'action-badge';
    actionBadge.textContent = res.isCurrentPage ? 'Jump' : 'Navigate';
    el.appendChild(actionBadge);

    el.addEventListener('click', () => {
      closePalette();
      if (res.isCurrentPage) {
        let target: Element | null = null;
        if (res.anchorId) {
          target = document.getElementById(res.anchorId) || document.querySelector(`[name="${res.anchorId}"]`);
        }
        if (!target && res.locator) {
          try {
            target = document.querySelector(res.locator);
          } catch {}
        }
        if (!target && res.title) {
          const headings = document.querySelectorAll('h1, h2, h3, h4, h5');
          for (const h of headings) {
            if ((h.textContent || '').trim() === res.title) {
              target = h.closest('section, article, div') || h;
              break;
            }
          }
        }
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.classList.remove('wayfindr-pulse-target');
          void (target as HTMLElement).offsetWidth;
          target.classList.add('wayfindr-pulse-target');
          return;
        }
      }

      let navUrl = res.targetUrl;
      if (!navUrl.includes('#')) {
        if (res.anchorId) {
          navUrl = `${navUrl}#${res.anchorId}`;
        } else if (res.textFragment) {
          navUrl = `${navUrl}${res.textFragment}`;
        }
      }

      if (isSafeNavigationUrl(navUrl)) {
        window.location.href = navUrl;
      } else {
        console.warn('[Wayfindr] Blocked navigation to unsafe URL scheme:', navUrl);
      }
    });

    resultsContainer.appendChild(el);
  });
}
