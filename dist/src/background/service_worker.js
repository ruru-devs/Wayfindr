import { extractSectionsFromHtml, extractValidInternalLinks } from '../engine/sectionizer';
import { ClientBM25Engine } from '../engine/bm25';
// Domains to ignore (search engines, video feeds, social networks)
const BLOCKED_DOMAINS = [
    'google.com', 'www.google.com',
    'bing.com', 'www.bing.com',
    'duckduckgo.com',
    'youtube.com', 'www.youtube.com',
    'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'reddit.com'
];
const MAX_PAGES_TO_CRAWL = 12; // High-efficiency crawl budget
const siteIndices = new Map();
function isDomainAllowed(domain) {
    return !BLOCKED_DOMAINS.some(b => domain === b || domain.endsWith(`.${b}`));
}
/**
 * Background Crawler Engine:
 * Fetches internal subpages using extension permissions (bypassing CORS),
 * extracts semantic sections, and builds BM25 index in memory.
 */
async function crawlDomain(originUrl) {
    const urlObj = new URL(originUrl);
    const domain = urlObj.hostname;
    if (!isDomainAllowed(domain)) {
        console.log(`[Wayfindr] Skipping blocked domain: ${domain}`);
        return [];
    }
    console.log(`[Wayfindr] Starting background crawl for: ${domain}`);
    const visitedUrls = new Set();
    const queue = [originUrl.split('#')[0]];
    const allSections = [];
    // Crawl up to MAX_PAGES_TO_CRAWL
    while (queue.length > 0 && visitedUrls.size < MAX_PAGES_TO_CRAWL) {
        const currentUrl = queue.shift();
        if (visitedUrls.has(currentUrl))
            continue;
        visitedUrls.add(currentUrl);
        try {
            const resp = await fetch(currentUrl, {
                method: 'GET',
                headers: { 'Accept': 'text/html,application/xhtml+xml' },
                cache: 'force-cache'
            });
            if (!resp.ok)
                continue;
            const contentType = resp.headers.get('content-type') || '';
            if (!contentType.includes('text/html'))
                continue;
            const html = await resp.text();
            const pageSections = extractSectionsFromHtml(html, currentUrl, domain);
            allSections.push(...pageSections);
            // Extract new internal links to queue
            const discoveredLinks = extractValidInternalLinks(html, currentUrl, domain);
            for (const link of discoveredLinks) {
                if (!visitedUrls.has(link) && !queue.includes(link)) {
                    queue.push(link);
                }
            }
        }
        catch (err) {
            console.warn(`[Wayfindr] Failed to crawl ${currentUrl}:`, err);
        }
    }
    console.log(`[Wayfindr] Crawled ${visitedUrls.size} pages, indexed ${allSections.length} sections for ${domain}`);
    // Build BM25 engine
    const engine = new ClientBM25Engine();
    engine.index(allSections);
    siteIndices.set(domain, { engine, sections: allSections, timestamp: Date.now() });
    // Save to chrome.storage.local for fast cache
    chrome.storage.local.set({
        [`wayfindr_${domain}`]: {
            sections: allSections,
            timestamp: Date.now()
        }
    });
    return allSections;
}
// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'PAGE_LOADED') {
        const url = message.url;
        try {
            const domain = new URL(url).hostname;
            if (isDomainAllowed(domain)) {
                // Check in-memory index or crawl
                if (!siteIndices.has(domain)) {
                    // Check storage cache
                    chrome.storage.local.get([`wayfindr_${domain}`], (res) => {
                        const cached = res[`wayfindr_${domain}`];
                        if (cached && (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000)) {
                            const engine = new ClientBM25Engine();
                            engine.index(cached.sections);
                            siteIndices.set(domain, { engine, sections: cached.sections, timestamp: cached.timestamp });
                            console.log(`[Wayfindr] Loaded ${domain} index from local cache (${cached.sections.length} sections)`);
                        }
                        else {
                            crawlDomain(url);
                        }
                    });
                }
            }
        }
        catch (e) {
            console.error('[Wayfindr] Invalid URL in PAGE_LOADED:', e);
        }
        sendResponse({ status: 'ACK' });
        return true;
    }
    if (message.action === 'SEARCH_QUERY') {
        const { query, url } = message;
        try {
            const domain = new URL(url).hostname;
            const site = siteIndices.get(domain);
            if (!site) {
                sendResponse({ results: [], status: 'INDEXING' });
                return true;
            }
            const results = site.engine.search(query, url, 6);
            sendResponse({ results, status: 'READY', indexedSectionsCount: site.sections.length });
        }
        catch (err) {
            sendResponse({ results: [], status: 'ERROR' });
        }
        return true;
    }
    if (message.action === 'TRIGGER_REINDEX') {
        const { url } = message;
        crawlDomain(url).then(sections => {
            sendResponse({ status: 'DONE', sectionsCount: sections.length });
        });
        return true;
    }
});
