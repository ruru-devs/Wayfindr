import { SectionNode, CrawlJob } from '../engine/types';
import { extractSectionsFromHtml, extractValidInternalLinks } from '../engine/sectionizer';
import { ClientBM25Engine } from '../engine/bm25';
import { isValidCrawlUrl } from '../engine/url_utils';

// Domains to ignore (search engines, video feeds, social networks)
const BLOCKED_DOMAINS = [
  'google.com', 'www.google.com',
  'bing.com', 'www.bing.com',
  'duckduckgo.com',
  'youtube.com', 'www.youtube.com',
  'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'reddit.com'
];

const MAX_PAGES_TO_CRAWL = 80; // High-capacity crawl budget

const siteIndices = new Map<string, { engine: ClientBM25Engine; sections: SectionNode[]; timestamp: number }>();

function isDomainAllowed(domain: string): boolean {
  return !BLOCKED_DOMAINS.some(b => domain === b || domain.endsWith(`.${b}`));
}

/**
 * Attempts to discover URLs from /sitemap.xml and /llms.txt before blind crawling
 */
async function discoverSeedUrls(originUrl: string, domain: string): Promise<string[]> {
  const seeds: string[] = [];
  const baseOrigin = new URL(originUrl).origin;

  // 1. Try llms.txt (LLM/Agent discovery standard)
  try {
    const llmResp = await fetch(`${baseOrigin}/llms.txt`, { method: 'GET', cache: 'force-cache' });
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
    const sitemapResp = await fetch(`${baseOrigin}/sitemap.xml`, { method: 'GET', cache: 'force-cache' });
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
 * Background Crawler Engine:
 * - Adapts depth: Depth 2 if at homepage/root (indexes all root links + their children), Depth 1 otherwise.
 * - Up to 80 pages crawled with link ranking and prioritization.
 * - Parses /sitemap.xml, /llms.txt, and schema.org JSON-LD data.
 */
async function crawlDomain(originUrl: string): Promise<SectionNode[]> {
  const urlObj = new URL(originUrl);
  const domain = urlObj.hostname;

  if (!isDomainAllowed(domain)) {
    console.log(`[Wayfindr] Skipping blocked domain: ${domain}`);
    return [];
  }

  // Check if we are at the homepage/root
  const isHomepage = urlObj.pathname === '/' || urlObj.pathname === '' || urlObj.pathname === '/index.html';
  const maxDepth = isHomepage ? 2 : 1;

  console.log(`[Wayfindr] Starting background crawl for: ${domain} (Homepage: ${isHomepage}, MaxDepth: ${maxDepth}, Budget: ${MAX_PAGES_TO_CRAWL})`);

  const visitedUrls = new Set<string>();
  // Queue stores: { url, depth, score }
  const queue: { url: string; depth: number; score: number }[] = [];

  const originClean = originUrl.split('#')[0].replace(/\/$/, '');
  queue.push({ url: originClean, depth: 0, score: 999 });

  // Add sitemap/llms.txt discovery seeds at depth 1
  try {
    const seedUrls = await discoverSeedUrls(originUrl, domain);
    for (const seed of seedUrls.slice(0, 30)) {
      if (seed !== originClean) {
        queue.push({ url: seed.replace(/\/$/, ''), depth: 1, score: 85 });
      }
    }
  } catch {}

  const allSections: SectionNode[] = [];

  while (queue.length > 0 && visitedUrls.size < MAX_PAGES_TO_CRAWL) {
    // Sort queue by priority score descending
    queue.sort((a, b) => b.score - a.score);
    const item = queue.shift()!;
    const currentUrl = item.url;

    if (visitedUrls.has(currentUrl)) continue;
    visitedUrls.add(currentUrl);

    try {
      const resp = await fetch(currentUrl, {
        method: 'GET',
        headers: { 'Accept': 'text/html,application/xhtml+xml' },
        cache: 'force-cache'
      });

      if (!resp.ok) continue;

      // Validate redirect destination
      if (resp.url && !isValidCrawlUrl(resp.url, domain)) {
        console.warn(`[Wayfindr] Crawl redirect to untrusted origin blocked: ${resp.url}`);
        continue;
      }

      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) continue;

      const html = await resp.text();
      const pageSections = extractSectionsFromHtml(html, currentUrl, domain);
      allSections.push(...pageSections);

      // Only discover deeper links if within depth limit
      if (item.depth < maxDepth) {
        const discoveredLinks = extractValidInternalLinks(html, currentUrl, domain);
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
    } catch (err) {
      console.warn(`[Wayfindr] Failed to crawl ${currentUrl}:`, err);
    }
  }

  console.log(`[Wayfindr] Crawled ${visitedUrls.size} pages, indexed ${allSections.length} sections for ${domain}`);

  // Build BM25 engine
  const engine = new ClientBM25Engine();
  engine.index(allSections);
  siteIndices.set(domain, { engine, sections: allSections, timestamp: Date.now() });

  // Save to chrome.storage.local for fast cache
  try {
    await chrome.storage.local.set({
      [`wayfindr_${domain}`]: {
        sections: allSections,
        timestamp: Date.now()
      }
    });
  } catch (err) {
    console.warn('[Wayfindr] Failed to save index to storage:', err);
  }

  return allSections;
}

// Unified message handler supporting both Chrome callback & Firefox Promise returns
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'PAGE_LOADED') {
    const url = message.url;
    const liveSections = (message.liveSections as SectionNode[]) || [];
    try {
      const domain = new URL(url).hostname;
      if (isDomainAllowed(domain)) {
        // Solution A: If content script sent live-rendered DOM sections, merge them immediately!
        if (liveSections.length > 0) {
          let currentSite = siteIndices.get(domain);
          if (!currentSite) {
            const engine = new ClientBM25Engine();
            engine.index(liveSections);
            siteIndices.set(domain, { engine, sections: liveSections, timestamp: Date.now() });
          } else {
            // Merge unique sections
            const existingIds = new Set(currentSite.sections.map(s => s.id));
            const newSections = liveSections.filter(s => !existingIds.has(s.id));
            if (newSections.length > 0) {
              const combined = [...currentSite.sections, ...newSections];
              currentSite.engine.index(combined);
              currentSite.sections = combined;
              siteIndices.set(domain, currentSite);
            }
          }
        }

        if (!siteIndices.has(domain)) {
          chrome.storage.local.get([`wayfindr_${domain}`], (res) => {
            const cached = res ? res[`wayfindr_${domain}`] : null;
            if (cached && (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000)) {
              const engine = new ClientBM25Engine();
              const merged = [...cached.sections, ...liveSections.filter(ls => !cached.sections.some((cs: SectionNode) => cs.id === ls.id))];
              engine.index(merged);
              siteIndices.set(domain, { engine, sections: merged, timestamp: cached.timestamp });
              console.log(`[Wayfindr] Loaded ${domain} index from local cache (${merged.length} sections)`);
              sendResponse({ status: 'CACHED', count: merged.length });
            } else {
              crawlDomain(url).then(sections => {
                const combined = [...sections, ...liveSections.filter(ls => !sections.some(cs => cs.id === ls.id))];
                sendResponse({ status: 'CRAWLED', count: combined.length });
              }).catch(err => {
                console.error('[Wayfindr] Crawl failed:', err);
                sendResponse({ status: 'ERROR', error: String(err) });
              });
            }
          });
          return true; // Keep channel open for async response
        } else {
          const site = siteIndices.get(domain);
          sendResponse({ status: 'READY', count: site?.sections.length || 0 });
          return false;
        }
      }
    } catch (e) {
      console.error('[Wayfindr] Invalid URL in PAGE_LOADED:', e);
    }
    sendResponse({ status: 'IGNORED' });
    return false;
  }

  if (message.action === 'SEARCH_QUERY') {
    const { query, url } = message;
    try {
      const domain = new URL(url).hostname;
      const site = siteIndices.get(domain);

      if (!site) {
        // If not in memory, check storage before declaring indexing
        chrome.storage.local.get([`wayfindr_${domain}`], (res) => {
          const cached = res ? res[`wayfindr_${domain}`] : null;
          if (cached && cached.sections) {
            const engine = new ClientBM25Engine();
            engine.index(cached.sections);
            siteIndices.set(domain, { engine, sections: cached.sections, timestamp: cached.timestamp });
            const results = engine.search(query, url, 6);
            sendResponse({ results, status: 'READY', indexedSectionsCount: cached.sections.length });
          } else {
            sendResponse({ results: [], status: 'INDEXING' });
          }
        });
        return true; // Keep channel open
      }

      const results = site.engine.search(query, url, 6);
      sendResponse({ results, status: 'READY', indexedSectionsCount: site.sections.length });
      return false;
    } catch (err) {
      sendResponse({ results: [], status: 'ERROR' });
      return false;
    }
  }

  if (message.action === 'TRIGGER_REINDEX') {
    const { url } = message;
    crawlDomain(url).then(sections => {
      sendResponse({ status: 'DONE', sectionsCount: sections.length });
    }).catch(err => {
      console.error('[Wayfindr] Re-index failed:', err);
      sendResponse({ status: 'ERROR', error: String(err) });
    });
    return true; // Keep channel open for async response
  }

  return false;
});

// Handle commands API (e.g. Alt+K configured in manifest.json)
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-wayfindr') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'TOGGLE_PALETTE' }).catch(() => {});
      }
    });
  }
});
