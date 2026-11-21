document.addEventListener('DOMContentLoaded', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const currentTab = tabs[0];
    if (!currentTab || !currentTab.url) return;

    try {
      const urlObj = new URL(currentTab.url);
      const domain = urlObj.hostname;
      if (!domain || urlObj.protocol.startsWith('chrome') || urlObj.protocol.startsWith('about')) {
        const domainEl = document.getElementById('domain');
        if (domainEl) domainEl.textContent = 'Browser Internal Page';
        const pageCountEl = document.getElementById('pageCount');
        if (pageCountEl) pageCountEl.textContent = 'Wayfindr is inactive here';
        const toggle = document.getElementById('domainToggle');
        if (toggle) toggle.disabled = true;
        return;
      }

      const domainEl = document.getElementById('domain');
      const stateBadge = document.getElementById('stateBadge');
      const pageCountEl = document.getElementById('pageCount');
      const domainToggle = document.getElementById('domainToggle');
      const statusMsg = document.getElementById('statusMsg');
      const openPaletteBtn = document.getElementById('openPaletteBtn');
      const reindexBtn = document.getElementById('reindexBtn');
      const clearIndexBtn = document.getElementById('clearIndexBtn');

      if (domainEl) {
        domainEl.textContent = domain;
        domainEl.title = domain;
      }

      function updateBadge(state, count) {
        if (!stateBadge || !pageCountEl) return;
        stateBadge.className = 'state-badge';

        if (domainToggle && !domainToggle.checked) {
          stateBadge.classList.add('disabled');
          stateBadge.textContent = 'DISABLED';
          pageCountEl.textContent = 'Navigation disabled for this site';
          return;
        }

        const normState = (state || 'UNINDEXED').toUpperCase();
        if (normState === 'READY') {
          stateBadge.classList.add('ready');
          stateBadge.textContent = 'READY';
          pageCountEl.textContent = `✓ ${count || 0} sections indexed`;
        } else if (normState === 'INDEXING' || normState === 'REINDEXING') {
          stateBadge.classList.add('indexing');
          stateBadge.textContent = normState;
          pageCountEl.textContent = '⚡ Crawling site in background...';
        } else if (normState === 'STALE') {
          stateBadge.classList.add('stale');
          stateBadge.textContent = 'STALE';
          pageCountEl.textContent = `⚠️ ${count || 0} sections (refreshing)`;
        } else {
          stateBadge.classList.add('unindexed');
          stateBadge.textContent = 'UNINDEXED';
          pageCountEl.textContent = 'Not indexed yet';
        }
      }

      // 1. Read domain enabled state
      chrome.storage.local.get([`wayfindr_disabled_${domain}`], (res) => {
        const isDisabled = !!res[`wayfindr_disabled_${domain}`];
        if (domainToggle) {
          domainToggle.checked = !isDisabled;
        }

        // 2. Query indexer state
        chrome.runtime.sendMessage({ action: 'GET_STATE', url: currentTab.url }, (resp) => {
          if (resp) {
            updateBadge(resp.state, resp.count);
          } else {
            updateBadge('UNINDEXED', 0);
          }
        });
      });

      // 3. Domain Toggle Handler
      if (domainToggle) {
        domainToggle.addEventListener('change', () => {
          const enabled = domainToggle.checked;
          chrome.storage.local.set({ [`wayfindr_disabled_${domain}`]: !enabled }, () => {
            if (statusMsg) {
              statusMsg.textContent = enabled ? 'Wayfindr enabled for site' : 'Wayfindr disabled for site';
              setTimeout(() => { if (statusMsg) statusMsg.textContent = ''; }, 2000);
            }
            chrome.runtime.sendMessage({ action: 'GET_STATE', url: currentTab.url }, (resp) => {
              updateBadge(resp?.state, resp?.count);
            });
          });
        });
      }

      // 4. Open Palette Handler
      if (openPaletteBtn) {
        openPaletteBtn.addEventListener('click', () => {
          chrome.tabs.sendMessage(currentTab.id, { action: 'TOGGLE_PALETTE' }).catch(() => {});
          window.close();
        });
      }

      // 5. Force Re-index Handler
      if (reindexBtn) {
        reindexBtn.addEventListener('click', () => {
          if (reindexBtn.disabled) return;
          reindexBtn.disabled = true;
          reindexBtn.textContent = '⚡ Indexing...';
          updateBadge('INDEXING', 0);

          chrome.runtime.sendMessage({ action: 'TRIGGER_REINDEX', url: currentTab.url }, (resp) => {
            reindexBtn.disabled = false;
            reindexBtn.textContent = '⚡ Force Re-index Site';
            if (resp && resp.status === 'DONE') {
              updateBadge('READY', resp.sectionsCount);
              if (statusMsg) {
                statusMsg.textContent = `✓ Indexed ${resp.sectionsCount} sections`;
                setTimeout(() => { if (statusMsg) statusMsg.textContent = ''; }, 2500);
              }
            } else {
              updateBadge('UNINDEXED', 0);
              if (statusMsg) {
                statusMsg.textContent = 'Index failed or site blocked';
                setTimeout(() => { if (statusMsg) statusMsg.textContent = ''; }, 2500);
              }
            }
          });
        });
      }

      // 6. Clear Index Handler
      if (clearIndexBtn) {
        clearIndexBtn.addEventListener('click', () => {
          chrome.runtime.sendMessage({ action: 'CLEAR_INDEX', domain }, (resp) => {
            if (resp && resp.status === 'CLEARED') {
              updateBadge('UNINDEXED', 0);
              if (statusMsg) {
                statusMsg.textContent = 'Index cleared for this site';
                setTimeout(() => { if (statusMsg) statusMsg.textContent = ''; }, 2000);
              }
            }
          });
        });
      }
    } catch (e) {
      console.error('[Wayfindr Popup]', e);
    }
  });
});
