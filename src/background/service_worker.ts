import { SectionNode } from '../engine/types';
import { extractSectionsFromHtml, extractValidInternalLinks } from '../engine/sectionizer';
import { ClientBM25Engine } from '../engine/bm25';
import { isValidCrawlUrl } from '../engine/url_utils';
import {
  IndexerCoordinator,
  DEFAULT_CRAWL_CONFIG,
  CrawlBudgetConfig,
  IndexState
} from './indexer_coordinator';

// Domains to ignore (search engines, video feeds, social networks, and sensitive banking/auth portals)
const BLOCKED_DOMAINS = [
  'google.com', 'www.google.com',
  'bing.com', 'www.bing.com',
  'duckduckgo.com',
  'youtube.com', 'www.youtube.com',
  'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'reddit.com', 'tiktok.com',
  // Banking & Payment portals
  'chase.com', 'bankofamerica.com', 'wellsfargo.com', 'citigroup.com',
  'paypal.com', 'stripe.com', 'coinbase.com',
  // Auth & Identity
  '1password.com', 'lastpass.com', 'bitwarden.com', 'okta.com'
];

let userExcludedDomains = new Set<string>();

if (typeof chrome !== 'undefined' && chrome.storage?.local) {
  chrome.storage.local.get(['wayfindr_excluded_domains'], (res) => {
    if (Array.isArray(res?.wayfindr_excluded_domains)) {
      userExcludedDomains = new Set(res.wayfindr_excluded_domains.map((d: string) => d.toLowerCase()));
    }
  });

  if (chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.wayfindr_excluded_domains) {
        const list = changes.wayfindr_excluded_domains.newValue;
        if (Array.isArray(list)) {
          userExcludedDomains = new Set(list.map((d: string) => d.toLowerCase()));
        }
      }
    });
  }
}

export const coordinator = new IndexerCoordinator(DEFAULT_CRAWL_CONFIG);

function isDomainAllowed(domain: string): boolean {
  const clean = domain.toLowerCase();
  if (userExcludedDomains.has(clean)) return false;
  return !BLOCKED_DOMAINS.some(b => clean === b || clean.endsWith(`.${b}`));
}

/**
 * Attempts to discover URLs from /sitemap.xml and /llms.txt before blind crawling
 */
async function discoverSeedUrls(
  originUrl: string,
  domain: string,
  signal?: AbortSignal
): Promise<string[]> {
  const seeds: string[] = [];
  const baseOrigin = new URL(originUrl).origin;

  // 1. Try llms.txt (LLM/Agent discovery standard)
  try {
    const llmResp = await fetch(`${baseOrigin}/llms.txt`, {
      method: 'GET',
      cache: 'force-cache',
      signal
    });
    if (llmResp.ok) {
      const text = await llmResp.text();
      const lines = text.split('\n');
      for (const line of lines) {
        const match = line.match(/https?:\/\/[^\s\)]+/);
        if (match && isValidCrawlUrl(match[0], domain)) {
          seeds.push(match[0]);
        }
      }
      if (seeds.length > 0) {
        console.log(`[Wayfindr] Discovered ${seeds.length} high-value URLs via /llms.txt`);
      }
    }
  } catch {}

  // 2. Try sitemap.xml
  try {
    const sitemapResp = await fetch(`${baseOrigin}/sitemap.xml`, {
      method: 'GET',
      cache: 'force-cache',
      signal
    });
    if (sitemapResp.ok) {
      const xml = await sitemapResp.text();
      const locMatches = xml.match(/<loc>(https?:\/\/[^<]+)<\/loc>/g);
      if (locMatches) {
        for (const locTag of locMatches) {
          const locUrl = locTag.replace(/<\/?loc>/g, '').trim();
          if (isValidCrawlUrl(locUrl, domain) && !locUrl.endsWith('.xml')) {
            seeds.push(locUrl);
          }
        }
        console.log(`[Wayfindr] Discovered ${locMatches.length} URLs via /sitemap.xml`);
      }
    }
  } catch {}

  return Array.from(new Set(seeds));
}

/**
 * Fetches an HTML page with timeout, Content-Length inspection,
 * Content-Type validation, and chunked response size cap.
 */
async function fetchHtmlWithBudget(
  url: string,
  timeoutMs: number,
  maxBytesPerPage: number,
  parentSignal?: AbortSignal
): Promise<{ html: string; finalUrl: string } | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const abortListener = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) return null;
    parentSignal.addEventListener('abort', abortListener);
  }

  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'text/html,application/xhtml+xml' },
      cache: 'force-cache',
      signal: controller.signal
    });

    if (!resp.ok) return null;

    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      return null;
    }

    const contentLength = resp.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > maxBytesPerPage) {
      console.warn(`[Wayfindr] Skipping ${url}: content-length ${contentLength} exceeds limit`);
      return null;
    }

    // Stream-limit response body to prevent memory blowout on unbounded responses
    if (!resp.body) {
      const text = await resp.text();
      return text.length <= maxBytesPerPage ? { html: text, finalUrl: resp.url } : null;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let totalBytes = 0;
    let html = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytesPerPage) {
        console.warn(`[Wayfindr] Truncating ${url}: stream exceeded ${maxBytesPerPage} bytes`);
        controller.abort();
        break;
      }
      html += decoder.decode(value, { stream: true });
    }
    html += decoder.decode();

    return { html, finalUrl: resp.url };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
    if (parentSignal) {
      parentSignal.removeEventListener('abort', abortListener);
    }
  }
}

/**
 * Background Bounded Concurrent Crawler:
 * - Adapts depth: Depth 2 at homepage, Depth 1 on subpages.
 * - Bounded concurrency (default: 3 parallel workers).
 * - Bounded total byte budget and per-page limits.
 * - Respects parent cancellation signal.
 */
export async function crawlDomain(
  originUrl: string,
  signal?: AbortSignal,
  customConfig?: Partial<CrawlBudgetConfig>
): Promise<SectionNode[]> {
  const config: CrawlBudgetConfig = { ...coordinator.getConfig(), ...customConfig };
  const urlObj = new URL(originUrl);
  const domain = urlObj.hostname;

  if (!isDomainAllowed(domain)) {
    console.log(`[Wayfindr] Skipping blocked domain: ${domain}`);
    return [];
  }

  const isHomepage = urlObj.pathname === '/' || urlObj.pathname === '' || urlObj.pathname === '/index.html';
  const maxDepth = isHomepage ? config.maxDepth : 1;

  console.log(`[Wayfindr] Starting bounded crawl for: ${domain} (MaxPages: ${config.maxPages}, Concurrency: ${config.concurrency})`);

  const visitedUrls = new Set<string>();
  const queue: { url: string; depth: number; score: number }[] = [];

  const originClean = originUrl.split('#')[0].replace(/\/$/, '');
  queue.push({ url: originClean, depth: 0, score: 999 });

  // Add sitemap/llms.txt discovery seeds at depth 1
  try {
    const seedUrls = await discoverSeedUrls(originUrl, domain, signal);
    for (const seed of seedUrls.slice(0, 30)) {
      if (seed !== originClean) {
        queue.push({ url: seed.replace(/\/$/, ''), depth: 1, score: 85 });
      }
    }
  } catch {}

  const allSections: SectionNode[] = [];
  let totalBytesCrawled = 0;

  // Bounded concurrency pool
  async function worker() {
    while (queue.length > 0 && visitedUrls.size < config.maxPages && totalBytesCrawled < config.maxBytesPerSite) {
      if (signal?.aborted) break;

      queue.sort((a, b) => b.score - a.score);
      const item = queue.shift();
      if (!item) break;

      if (visitedUrls.has(item.url)) continue;
      visitedUrls.add(item.url);

      const fetchRes = await fetchHtmlWithBudget(
        item.url,
        config.requestTimeoutMs,
        config.maxBytesPerPage,
        signal
      );

      if (!fetchRes || signal?.aborted) continue;

      // Validate redirect destination
      if (fetchRes.finalUrl && !isValidCrawlUrl(fetchRes.finalUrl, domain)) {
        console.warn(`[Wayfindr] Crawl redirect to untrusted origin blocked: ${fetchRes.finalUrl}`);
        continue;
      }

      totalBytesCrawled += fetchRes.html.length;

      const pageSections = extractSectionsFromHtml(fetchRes.html, item.url, domain);
      allSections.push(...pageSections);

      // Enqueue child links if within depth limit
      if (item.depth < maxDepth && visitedUrls.size < config.maxPages) {
        const discoveredLinks = extractValidInternalLinks(fetchRes.html, item.url, domain);
        for (const linkObj of discoveredLinks) {
          if (!visitedUrls.has(linkObj.url) && !queue.some(q => q.url === linkObj.url)) {
            queue.push({
              url: linkObj.url,
              depth: item.depth + 1,
              score: linkObj.score
            });
          }
        }
      }
    }
  }

  const workerCount = Math.min(config.concurrency, 4);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  console.log(`[Wayfindr] Crawled ${visitedUrls.size} pages, indexed ${allSections.length} sections for ${domain}`);

  // Persist to storage
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({
        [`wayfindr_${domain}`]: {
          sections: allSections,
          timestamp: Date.now()
        }
      });
    }
  } catch (err) {
    console.warn('[Wayfindr] Failed to save index to storage:', err);
  }

  return allSections;
}

/**
 * Initiates crawl with coordinator concurrency locking
 */
function initiateCrawl(originUrl: string): Promise<SectionNode[]> {
  const domain = new URL(originUrl).hostname;
  return coordinator.registerActiveCrawl(domain, (signal) => {
    return crawlDomain(originUrl, signal, coordinator.getConfig());
  });
}

// Unified message handler supporting Chrome callbacks & Firefox Promises
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'PAGE_LOADED') {
    const url = message.url;
    const liveSections = (message.liveSections as SectionNode[]) || [];
    try {
      const domain = new URL(url).hostname;
      if (!isDomainAllowed(domain)) {
        sendResponse({ status: 'IGNORED' });
        return false;
      }

      // Merge content script live DOM sections
      if (liveSections.length > 0) {
        coordinator.mergeLivePageSections(domain, url, liveSections);
      }

      coordinator.ensureIndexLoaded(domain).then(({ record, state }) => {
        if (state === 'READY') {
          sendResponse({ status: 'READY', count: record?.sections.length || 0 });
        } else if (state === 'STALE') {
          // Serve stale index instantly, trigger background refresh
          initiateCrawl(url).catch(() => {});
          sendResponse({ status: 'STALE', count: record?.sections.length || 0 });
        } else if (state === 'INDEXING' || state === 'REINDEXING') {
          sendResponse({ status: state, count: record?.sections.length || 0 });
        } else {
          // UNINDEXED
          initiateCrawl(url)
            .then(sections => {
              sendResponse({ status: 'CRAWLED', count: sections.length });
            })
            .catch(err => {
              sendResponse({ status: 'ERROR', error: String(err) });
            });
        }
      });
      return true; // Keep channel open for async response
    } catch (e) {
      console.error('[Wayfindr] Invalid URL in PAGE_LOADED:', e);
      sendResponse({ status: 'ERROR' });
      return false;
    }
  }

  if (message.action === 'SEARCH_QUERY') {
    const { query, url } = message;
    try {
      const domain = new URL(url).hostname;

      coordinator.ensureIndexLoaded(domain).then(({ record, state }) => {
        if (!record || record.sections.length === 0) {
          sendResponse({ results: [], status: state, indexedSectionsCount: 0 });
          return;
        }

        const results = record.engine.search(query, url, 6);
        sendResponse({
          results,
          status: state,
          indexedSectionsCount: record.sections.length
        });
      });
      return true; // Keep channel open
    } catch {
      sendResponse({ results: [], status: 'ERROR' });
      return false;
    }
  }

  if (message.action === 'TRIGGER_REINDEX') {
    const { url } = message;
    try {
      const domain = new URL(url).hostname;
      coordinator.cancelActiveCrawl(domain);
      initiateCrawl(url)
        .then(sections => {
          sendResponse({ status: 'DONE', sectionsCount: sections.length });
        })
        .catch(err => {
          sendResponse({ status: 'ERROR', error: String(err) });
        });
      return true;
    } catch (err) {
      sendResponse({ status: 'ERROR', error: String(err) });
      return false;
    }
  }

  if (message.action === 'GET_STATE') {
    const { url } = message;
    try {
      const domain = new URL(url).hostname;
      coordinator.ensureIndexLoaded(domain).then(({ record, state }) => {
        sendResponse({ state, count: record?.sections.length || 0 });
      }).catch(() => {
        sendResponse({ state: coordinator.getState(domain), count: 0 });
      });
      return true;
    } catch {
      sendResponse({ state: 'UNINDEXED', count: 0 });
      return false;
    }
  }

  if (message.action === 'CLEAR_INDEX') {
    const domain = message.domain;
    try {
      coordinator.cancelActiveCrawl(domain);
      coordinator.setState(domain, 'UNINDEXED');
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.remove([`wayfindr_${domain}`, `wayfindr_state_${domain}`]);
      }
      sendResponse({ status: 'CLEARED' });
      return false;
    } catch (e) {
      sendResponse({ status: 'ERROR', error: String(e) });
      return false;
    }
  }

  return false;
});

// Handle commands API (Alt+K configured in manifest.json)
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-wayfindr') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'TOGGLE_PALETTE' }).catch(() => {});
      }
    });
  }
});
