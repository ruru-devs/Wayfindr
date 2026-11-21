(() => {
  // src/engine/url_utils.ts
  function isValidCrawlUrl(candidateUrl, targetDomain, allowSubdomains = true) {
    if (!candidateUrl || typeof candidateUrl !== "string") return false;
    if (!targetDomain || typeof targetDomain !== "string") return false;
    try {
      const parsed = new URL(candidateUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return false;
      }
      if (parsed.username || parsed.password) {
        return false;
      }
      const candidateHost = parsed.hostname.toLowerCase();
      const cleanTargetDomain = targetDomain.toLowerCase().replace(/:\d+$/, "");
      if (candidateHost === cleanTargetDomain) {
        return true;
      }
      if (cleanTargetDomain.startsWith("www.")) {
        const bareTarget = cleanTargetDomain.slice(4);
        if (candidateHost === bareTarget) return true;
        if (allowSubdomains && candidateHost.endsWith(`.${bareTarget}`)) return true;
      } else {
        if (candidateHost === `www.${cleanTargetDomain}`) return true;
        if (allowSubdomains && candidateHost.endsWith(`.${cleanTargetDomain}`)) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // src/engine/sectionizer.ts
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
    let idx = 0;
    for (const block of candidates) {
      const text = (block.textContent || "").trim().replace(/\s+/g, " ");
      if (text.length < 25) continue;
      const heading = block.querySelector("h1, h2, h3, h4, h5");
      let title = (heading?.textContent || "").trim();
      if (!title) {
        const strong = block.querySelector("strong, b");
        title = (strong?.textContent || "").trim() || text.split(/\s+/).slice(0, 6).join(" ");
      }
      const anchorId = block.id || heading?.id || "";
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
        id: `sec_${idx}_${anchorId || "block"}`,
        url: pageUrl,
        pageTitle: pageDocTitle || "Page",
        anchorId: anchorId || void 0,
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
  function extractSectionsFromHtml(htmlContent, pageUrl, pageDocTitle) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, "text/html");
    return extractSectionsFromDoc(doc, pageUrl, pageDocTitle);
  }
  function scoreLinkPriority(pathname, search) {
    let score = 50;
    const lowPriorityRegex = /(?:[?&](?:page|p|year|month|date|replytocom|filter|sort|order)=|\/(?:tag|category|author|page|archive|20\d\d)\/)/i;
    if (lowPriorityRegex.test(pathname) || lowPriorityRegex.test(search)) {
      return -100;
    }
    const highPriorityKeywords = [
      { pattern: /\b(pricing|price|fees|plans|rates)\b/i, boost: 40 },
      { pattern: /\b(docs|documentation|guide|manual|specs|specification|features)\b/i, boost: 35 },
      { pattern: /\b(service|services|departments|specialties|treatments|doctors|physicians|team)\b/i, boost: 30 },
      { pattern: /\b(policy|policies|returns|refund|warranty|shipping|faq|help|terms)\b/i, boost: 30 },
      { pattern: /\b(about|contact|location|hours|timings|admission|schedule|book|appointment)\b/i, boost: 25 },
      { pattern: /\b(products|shop|catalog|courses|programs)\b/i, boost: 20 }
    ];
    for (const { pattern, boost } of highPriorityKeywords) {
      if (pattern.test(pathname)) {
        score += boost;
      }
    }
    const depth = (pathname.match(/\//g) || []).length;
    if (depth <= 2) score += 15;
    else if (depth > 4) score -= 15;
    return score;
  }
  function extractValidInternalLinks(htmlContent, baseUrl, originDomain) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, "text/html");
    const anchors = doc.querySelectorAll("a[href]");
    const discoveredMap = /* @__PURE__ */ new Map();
    const ignoreExtRegex = /\.(pdf|zip|rar|tar|gz|jpg|jpeg|png|gif|svg|webp|mp4|webm|exe|apk|dmg|iso|css|js)$/i;
    const skipPathRegex = /\b(login|logout|signin|signup|cart|checkout|auth|oauth|share|facebook|twitter|instagram|linkedin|youtube|pinterest)\b/i;
    anchors.forEach((a) => {
      try {
        const rawHref = a.getAttribute("href");
        if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("javascript:") || rawHref.startsWith("mailto:") || rawHref.startsWith("tel:")) {
          return;
        }
        const resolved = new URL(rawHref, baseUrl);
        if (!isValidCrawlUrl(resolved.href, originDomain)) {
          return;
        }
        if (ignoreExtRegex.test(resolved.pathname) || skipPathRegex.test(resolved.pathname)) {
          return;
        }
        const priority = scoreLinkPriority(resolved.pathname, resolved.search);
        if (priority < 0) {
          return;
        }
        const cleanUrl = `${resolved.origin}${resolved.pathname}`.replace(/\/$/, "");
        if (cleanUrl !== baseUrl.replace(/\/$/, "")) {
          const existingScore = discoveredMap.get(cleanUrl);
          if (existingScore === void 0 || priority > existingScore) {
            discoveredMap.set(cleanUrl, priority);
          }
        }
      } catch {
      }
    });
    return Array.from(discoveredMap.entries()).map(([url, score]) => ({ url, score })).sort((a, b) => b.score - a.score);
  }

  // src/engine/bm25.ts
  var ClientBM25Engine = class {
    constructor() {
      this.k1 = 1.5;
      this.b = 0.75;
      this.sections = [];
      this.docTokens = [];
      this.docLengths = [];
      this.avgDocLength = 0;
      this.docFreqs = /* @__PURE__ */ new Map();
    }
    index(sections) {
      this.sections = sections;
      this.docTokens = [];
      this.docLengths = [];
      this.docFreqs.clear();
      let totalLen = 0;
      for (const sec of sections) {
        const fullText = `${sec.title} ${sec.pageTitle} ${sec.snippet} ${sec.metadata?.price || ""} ${sec.metadata?.timings || ""}`;
        const tokens = this.tokenize(fullText);
        this.docTokens.push(tokens);
        this.docLengths.push(tokens.length);
        totalLen += tokens.length;
        const uniqueTokens = new Set(tokens);
        for (const token of uniqueTokens) {
          this.docFreqs.set(token, (this.docFreqs.get(token) || 0) + 1);
        }
      }
      this.avgDocLength = sections.length > 0 ? totalLen / sections.length : 1;
    }
    tokenize(text) {
      return text.toLowerCase().match(/\b[a-z0-9_-]{2,}\b/g) || [];
    }
    search(query, currentUrl, topK = 6) {
      const qTokens = this.tokenize(query);
      if (!qTokens.length || !this.sections.length) return [];
      const scores = [];
      const N = this.sections.length;
      const qClean = query.toLowerCase().trim();
      for (let i = 0; i < N; i++) {
        const doc = this.sections[i];
        const tokens = this.docTokens[i];
        const docLen = this.docLengths[i];
        let bm25Score = 0;
        const termFreqs = /* @__PURE__ */ new Map();
        for (const t of tokens) {
          termFreqs.set(t, (termFreqs.get(t) || 0) + 1);
        }
        for (const qTerm of qTokens) {
          const tf = termFreqs.get(qTerm) || 0;
          const df = this.docFreqs.get(qTerm) || 0;
          if (df === 0 || tf === 0) continue;
          const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
          const numerator = tf * (this.k1 + 1);
          const denominator = tf + this.k1 * (1 - this.b + this.b * (docLen / this.avgDocLength));
          bm25Score += idf * (numerator / denominator);
        }
        let boost = 0;
        const titleLower = doc.title.toLowerCase();
        if (titleLower.includes(qClean)) {
          boost += 12;
        } else if (qTokens.some((t) => titleLower.includes(t))) {
          boost += 4.5;
        }
        if (/price|cost|fee|₹|\$|timing|hour|schedule|doctor|return|spec/i.test(qClean)) {
          if (doc.metadata?.price || doc.metadata?.timings || /spec|policy|return/i.test(doc.url)) {
            boost += 3.5;
          }
        }
        const totalScore = bm25Score + boost;
        if (totalScore > 0.8) {
          scores.push({
            index: i,
            score: totalScore,
            matchType: boost >= 10 ? "title" : totalScore >= 4 ? "exact_keyword" : "semantic"
          });
        }
      }
      scores.sort((a, b) => b.score - a.score);
      return scores.slice(0, topK).map((s) => {
        const sec = this.sections[s.index];
        let targetUrl = sec.url;
        if (sec.anchorId && !targetUrl.includes("#")) {
          targetUrl = `${targetUrl}#${sec.anchorId}`;
        }
        const isCurrentPage = currentUrl.split("#")[0].replace(/\/$/, "") === sec.url.split("#")[0].replace(/\/$/, "");
        return {
          ...sec,
          targetUrl,
          score: Math.round(s.score * 100) / 100,
          matchType: s.matchType,
          isCurrentPage
        };
      });
    }
  };

  // src/background/service_worker.ts
  var BLOCKED_DOMAINS = [
    "google.com",
    "www.google.com",
    "bing.com",
    "www.bing.com",
    "duckduckgo.com",
    "youtube.com",
    "www.youtube.com",
    "facebook.com",
    "twitter.com",
    "x.com",
    "instagram.com",
    "reddit.com"
  ];
  var MAX_PAGES_TO_CRAWL = 80;
  var siteIndices = /* @__PURE__ */ new Map();
  function isDomainAllowed(domain) {
    return !BLOCKED_DOMAINS.some((b) => domain === b || domain.endsWith(`.${b}`));
  }
  async function discoverSeedUrls(originUrl, domain) {
    const seeds = [];
    const baseOrigin = new URL(originUrl).origin;
    try {
      const llmResp = await fetch(`${baseOrigin}/llms.txt`, { method: "GET", cache: "force-cache" });
      if (llmResp.ok) {
        const text = await llmResp.text();
        const lines = text.split("\n");
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
    } catch {
    }
    try {
      const sitemapResp = await fetch(`${baseOrigin}/sitemap.xml`, { method: "GET", cache: "force-cache" });
      if (sitemapResp.ok) {
        const xml = await sitemapResp.text();
        const locMatches = xml.match(/<loc>(https?:\/\/[^<]+)<\/loc>/g);
        if (locMatches) {
          for (const locTag of locMatches) {
            const locUrl = locTag.replace(/<\/?loc>/g, "").trim();
            if (isValidCrawlUrl(locUrl, domain) && !locUrl.endsWith(".xml")) {
              seeds.push(locUrl);
            }
          }
          console.log(`[Wayfindr] Discovered ${locMatches.length} URLs via /sitemap.xml`);
        }
      }
    } catch {
    }
    return Array.from(new Set(seeds));
  }
  async function crawlDomain(originUrl) {
    const urlObj = new URL(originUrl);
    const domain = urlObj.hostname;
    if (!isDomainAllowed(domain)) {
      console.log(`[Wayfindr] Skipping blocked domain: ${domain}`);
      return [];
    }
    const isHomepage = urlObj.pathname === "/" || urlObj.pathname === "" || urlObj.pathname === "/index.html";
    const maxDepth = isHomepage ? 2 : 1;
    console.log(`[Wayfindr] Starting background crawl for: ${domain} (Homepage: ${isHomepage}, MaxDepth: ${maxDepth}, Budget: ${MAX_PAGES_TO_CRAWL})`);
    const visitedUrls = /* @__PURE__ */ new Set();
    const queue = [];
    const originClean = originUrl.split("#")[0].replace(/\/$/, "");
    queue.push({ url: originClean, depth: 0, score: 999 });
    try {
      const seedUrls = await discoverSeedUrls(originUrl, domain);
      for (const seed of seedUrls.slice(0, 30)) {
        if (seed !== originClean) {
          queue.push({ url: seed.replace(/\/$/, ""), depth: 1, score: 85 });
        }
      }
    } catch {
    }
    const allSections = [];
    while (queue.length > 0 && visitedUrls.size < MAX_PAGES_TO_CRAWL) {
      queue.sort((a, b) => b.score - a.score);
      const item = queue.shift();
      const currentUrl = item.url;
      if (visitedUrls.has(currentUrl)) continue;
      visitedUrls.add(currentUrl);
      try {
        const resp = await fetch(currentUrl, {
          method: "GET",
          headers: { "Accept": "text/html,application/xhtml+xml" },
          cache: "force-cache"
        });
        if (!resp.ok) continue;
        if (resp.url && !isValidCrawlUrl(resp.url, domain)) {
          console.warn(`[Wayfindr] Crawl redirect to untrusted origin blocked: ${resp.url}`);
          continue;
        }
        const contentType = resp.headers.get("content-type") || "";
        if (!contentType.includes("text/html")) continue;
        const html = await resp.text();
        const pageSections = extractSectionsFromHtml(html, currentUrl, domain);
        allSections.push(...pageSections);
        if (item.depth < maxDepth) {
          const discoveredLinks = extractValidInternalLinks(html, currentUrl, domain);
          for (const linkObj of discoveredLinks) {
            if (!visitedUrls.has(linkObj.url) && !queue.some((q) => q.url === linkObj.url)) {
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
    const engine = new ClientBM25Engine();
    engine.index(allSections);
    siteIndices.set(domain, { engine, sections: allSections, timestamp: Date.now() });
    try {
      await chrome.storage.local.set({
        [`wayfindr_${domain}`]: {
          sections: allSections,
          timestamp: Date.now()
        }
      });
    } catch (err) {
      console.warn("[Wayfindr] Failed to save index to storage:", err);
    }
    return allSections;
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "PAGE_LOADED") {
      const url = message.url;
      const liveSections = message.liveSections || [];
      try {
        const domain = new URL(url).hostname;
        if (isDomainAllowed(domain)) {
          if (liveSections.length > 0) {
            let currentSite = siteIndices.get(domain);
            if (!currentSite) {
              const engine = new ClientBM25Engine();
              engine.index(liveSections);
              siteIndices.set(domain, { engine, sections: liveSections, timestamp: Date.now() });
            } else {
              const existingIds = new Set(currentSite.sections.map((s) => s.id));
              const newSections = liveSections.filter((s) => !existingIds.has(s.id));
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
              if (cached && Date.now() - cached.timestamp < 24 * 60 * 60 * 1e3) {
                const engine = new ClientBM25Engine();
                const merged = [...cached.sections, ...liveSections.filter((ls) => !cached.sections.some((cs) => cs.id === ls.id))];
                engine.index(merged);
                siteIndices.set(domain, { engine, sections: merged, timestamp: cached.timestamp });
                console.log(`[Wayfindr] Loaded ${domain} index from local cache (${merged.length} sections)`);
                sendResponse({ status: "CACHED", count: merged.length });
              } else {
                crawlDomain(url).then((sections) => {
                  const combined = [...sections, ...liveSections.filter((ls) => !sections.some((cs) => cs.id === ls.id))];
                  sendResponse({ status: "CRAWLED", count: combined.length });
                }).catch((err) => {
                  console.error("[Wayfindr] Crawl failed:", err);
                  sendResponse({ status: "ERROR", error: String(err) });
                });
              }
            });
            return true;
          } else {
            const site = siteIndices.get(domain);
            sendResponse({ status: "READY", count: site?.sections.length || 0 });
            return false;
          }
        }
      } catch (e) {
        console.error("[Wayfindr] Invalid URL in PAGE_LOADED:", e);
      }
      sendResponse({ status: "IGNORED" });
      return false;
    }
    if (message.action === "SEARCH_QUERY") {
      const { query, url } = message;
      try {
        const domain = new URL(url).hostname;
        const site = siteIndices.get(domain);
        if (!site) {
          chrome.storage.local.get([`wayfindr_${domain}`], (res) => {
            const cached = res ? res[`wayfindr_${domain}`] : null;
            if (cached && cached.sections) {
              const engine = new ClientBM25Engine();
              engine.index(cached.sections);
              siteIndices.set(domain, { engine, sections: cached.sections, timestamp: cached.timestamp });
              const results2 = engine.search(query, url, 6);
              sendResponse({ results: results2, status: "READY", indexedSectionsCount: cached.sections.length });
            } else {
              sendResponse({ results: [], status: "INDEXING" });
            }
          });
          return true;
        }
        const results = site.engine.search(query, url, 6);
        sendResponse({ results, status: "READY", indexedSectionsCount: site.sections.length });
        return false;
      } catch (err) {
        sendResponse({ results: [], status: "ERROR" });
        return false;
      }
    }
    if (message.action === "TRIGGER_REINDEX") {
      const { url } = message;
      crawlDomain(url).then((sections) => {
        sendResponse({ status: "DONE", sectionsCount: sections.length });
      }).catch((err) => {
        console.error("[Wayfindr] Re-index failed:", err);
        sendResponse({ status: "ERROR", error: String(err) });
      });
      return true;
    }
    return false;
  });
  chrome.commands.onCommand.addListener((command) => {
    if (command === "toggle-wayfindr") {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { action: "TOGGLE_PALETTE" }).catch(() => {
          });
        }
      });
    }
  });
})();
