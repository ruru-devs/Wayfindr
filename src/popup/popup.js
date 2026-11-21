chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const currentTab = tabs[0];
  if (!currentTab || !currentTab.url) return;

  try {
    const domain = new URL(currentTab.url).hostname;
    const domainEl = document.getElementById('domain');
    if (domainEl) domainEl.innerText = domain;

    chrome.storage.local.get([`wayfindr_${domain}`], (res) => {
      const cached = res[`wayfindr_${domain}`];
      const countEl = document.getElementById('pageCount');
      if (countEl) {
        if (cached && cached.sections) {
          countEl.innerText = `✓ ${cached.sections.length} sections indexed`;
        } else {
          countEl.innerText = `⚡ Auto-crawling subpages...`;
        }
      }
    });

    const reindexBtn = document.getElementById('reindexBtn');
    if (reindexBtn) {
      reindexBtn.addEventListener('click', () => {
        reindexBtn.innerText = 'Crawling...';
        chrome.runtime.sendMessage({ action: 'TRIGGER_REINDEX', url: currentTab.url }, (resp) => {
          if (resp && resp.status === 'DONE') {
            reindexBtn.innerText = `✓ Indexed (${resp.sectionsCount} items)`;
            const countEl = document.getElementById('pageCount');
            if (countEl) countEl.innerText = `✓ ${resp.sectionsCount} sections indexed`;
          } else {
            reindexBtn.innerText = 'Error crawling';
          }
          setTimeout(() => window.close(), 1200);
        });
      });
    }
  } catch (e) {
    console.error(e);
  }
});
