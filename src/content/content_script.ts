import { SearchResultItem } from '../engine/types';

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
      const el = document.getElementById(hash) || document.querySelector(`[name="${hash}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('wayfindr-pulse-target');
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

// Initialize on page load
checkAndHighlightTarget();
chrome.runtime.sendMessage({ action: 'PAGE_LOADED', url: window.location.href });

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
      <span>Sub-10ms Cross-Page Jump</span>
    </div>
  </div>
`;
shadow.appendChild(backdrop);

const searchInput = backdrop.querySelector('.search-input') as HTMLInputElement;
const resultsContainer = backdrop.querySelector('.results') as HTMLDivElement;

function openPalette() {
  backdrop.classList.add('open');
  searchInput.focus();
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
// Supports: Ctrl+K, Cmd+K, Alt+K, and Ctrl+Shift+K
window.addEventListener('keydown', (e) => {
  const isK = e.key.toLowerCase() === 'k';
  const isCtrlOrCmd = e.ctrlKey || e.metaKey;
  const isAlt = e.altKey;
  const isShift = e.shiftKey;

  if (isK && (isAlt || isCtrlOrCmd || (isCtrlOrCmd && isShift))) {
    e.preventDefault();
    e.stopPropagation();
    togglePalette();
    return;
  }
  if (e.key === 'Escape' && backdrop.classList.contains('open')) {
    e.preventDefault();
    closePalette();
  }
}, true); // useCapture = true ensures Wayfindr intercepts the hotkey before native Firefox search focus

backdrop.addEventListener('click', (e) => {
  if (e.target === backdrop) closePalette();
});

let debounce: any = null;
searchInput.addEventListener('input', () => {
  clearTimeout(debounce);
  const q = searchInput.value.trim();
  if (!q) {
    resultsContainer.innerHTML = `
      <div style="padding: 16px; text-align: center; color: #94a3b8; font-size: 13px;">
        Type an instruction or intent to instantly cross-navigate this website...
      </div>
    `;
    return;
  }

  debounce = setTimeout(() => {
    chrome.runtime.sendMessage({ action: 'SEARCH_QUERY', query: q, url: window.location.href }, (resp) => {
      renderResults(resp?.results || []);
    });
  }, 100);
});

function renderResults(results: SearchResultItem[]) {
  resultsContainer.innerHTML = '';
  if (!results.length) {
    resultsContainer.innerHTML = `
      <div style="padding: 24px; text-align: center; color: #64748b; font-size: 13.5px;">
        No destination matching your search was found across this website.
      </div>
    `;
    return;
  }

  results.forEach(res => {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <div class="item-main">
        <div class="item-page">${res.isCurrentPage ? 'Current Page' : 'Cross-Page Link'} › ${res.pageTitle}</div>
        <div class="item-title">${res.title}</div>
        <div class="item-snippet">${res.snippet}</div>
        ${res.metadata?.price ? `<div class="item-meta">💰 ${res.metadata.price}</div>` : ''}
        ${res.metadata?.timings ? `<div class="item-meta">🕒 ${res.metadata.timings}</div>` : ''}
      </div>
      <div class="action-badge">${res.isCurrentPage ? 'Jump' : 'Navigate'}</div>
    `;

    el.addEventListener('click', () => {
      closePalette();
      if (res.isCurrentPage && res.anchorId) {
        const target = document.getElementById(res.anchorId);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.classList.remove('wayfindr-pulse-target');
          void target.offsetWidth;
          target.classList.add('wayfindr-pulse-target');
          return;
        }
      }
      window.location.href = res.targetUrl;
    });

    resultsContainer.appendChild(el);
  });
}
