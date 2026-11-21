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

  // src/background/indexer_coordinator.ts
  var DEFAULT_CRAWL_CONFIG = {
    maxPages: 30,
    maxDepth: 2,
    maxBytesPerSite: 10 * 1024 * 1024,
    // 10 MB total
    maxBytesPerPage: 1024 * 1024,
    // 1 MB per page
    requestTimeoutMs: 8e3,
    // 8 seconds
    concurrency: 3,
    cacheTtlMs: 24 * 60 * 60 * 1e3
    // 24 hours
  };
  var IndexerCoordinator = class {
    constructor(config = {}) {
      this.inMemoryIndices = /* @__PURE__ */ new Map();
      this.activeCrawlJobs = /* @__PURE__ */ new Map();
      this.domainStates = /* @__PURE__ */ new Map();
      this.config = { ...DEFAULT_CRAWL_CONFIG, ...config };
    }
    getConfig() {
      return this.config;
    }
    getState(domain) {
      return this.domainStates.get(domain) || "UNINDEXED";
    }
    setState(domain, state) {
      this.domainStates.set(domain, state);
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          chrome.storage.local.set({ [`wayfindr_state_${domain}`]: state }).catch(() => {
          });
        }
      } catch {
      }
    }
    getSiteIndex(domain) {
      return this.inMemoryIndices.get(domain);
    }
    setSiteIndex(domain, record) {
      this.inMemoryIndices.set(domain, record);
      this.setState(domain, "READY");
    }
    hasActiveCrawl(domain) {
      return this.activeCrawlJobs.has(domain);
    }
    getActiveCrawl(domain) {
      return this.activeCrawlJobs.get(domain)?.promise;
    }
    registerActiveCrawl(domain, crawlPromiseFactory) {
      const existing = this.activeCrawlJobs.get(domain);
      if (existing) {
        console.log(`[Coordinator] Multiple tabs requested crawl for ${domain}; attaching to active job.`);
        return existing.promise;
      }
      const abortController = new AbortController();
      const isReindex = this.inMemoryIndices.has(domain);
      this.setState(domain, isReindex ? "REINDEXING" : "INDEXING");
      const promise = crawlPromiseFactory(abortController.signal).then((sections) => {
        const engine = new ClientBM25Engine();
        engine.index(sections);
        const record = {
          engine,
          sections,
          timestamp: Date.now(),
          pagesCount: new Set(sections.map((s) => s.url)).size
        };
        this.setSiteIndex(domain, record);
        this.setState(domain, "READY");
        return sections;
      }).catch((err) => {
        if (abortController.signal.aborted) {
          console.log(`[Coordinator] Crawl for ${domain} was cancelled.`);
        } else {
          console.error(`[Coordinator] Crawl failed for ${domain}:`, err);
        }
        this.setState(domain, this.inMemoryIndices.has(domain) ? "STALE" : "UNINDEXED");
        throw err;
      }).finally(() => {
        this.activeCrawlJobs.delete(domain);
      });
      this.activeCrawlJobs.set(domain, { promise, abortController });
      return promise;
    }
    cancelActiveCrawl(domain) {
      const job = this.activeCrawlJobs.get(domain);
      if (job) {
        job.abortController.abort();
        this.activeCrawlJobs.delete(domain);
        this.setState(domain, this.inMemoryIndices.has(domain) ? "STALE" : "UNINDEXED");
      }
    }
    /**
     * Rebuilds in-memory index from chrome.storage.local on demand
     * when service worker wakes up from idle termination.
     */
    async ensureIndexLoaded(domain) {
      const memRecord = this.inMemoryIndices.get(domain);
      if (memRecord) {
        const isStale = Date.now() - memRecord.timestamp > this.config.cacheTtlMs;
        const state = isStale ? "STALE" : "READY";
        this.setState(domain, state);
        return { record: memRecord, state };
      }
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        try {
          const key = `wayfindr_${domain}`;
          const res = await chrome.storage.local.get([key, `wayfindr_state_${domain}`]);
          const cached = res ? res[key] : null;
          if (cached && Array.isArray(cached.sections) && cached.sections.length > 0) {
            const engine = new ClientBM25Engine();
            engine.index(cached.sections);
            const isStale = Date.now() - (cached.timestamp || 0) > this.config.cacheTtlMs;
            const state = isStale ? "STALE" : "READY";
            const record = {
              engine,
              sections: cached.sections,
              timestamp: cached.timestamp || Date.now(),
              pagesCount: new Set(cached.sections.map((s) => s.url)).size
            };
            this.inMemoryIndices.set(domain, record);
            this.setState(domain, state);
            return { record, state };
          }
        } catch (e) {
          console.warn(`[Coordinator] Error reviving cache for ${domain}:`, e);
        }
      }
      return { record: void 0, state: "UNINDEXED" };
    }
    /**
     * Replaces sections belonging to a specific page rather than accumulating duplicates.
     */
    mergeLivePageSections(domain, pageUrl, liveSections) {
      const current = this.inMemoryIndices.get(domain);
      if (!current) {
        const engine = new ClientBM25Engine();
        engine.index(liveSections);
        const record = {
          engine,
          sections: liveSections,
          timestamp: Date.now(),
          pagesCount: 1
        };
        this.setSiteIndex(domain, record);
        return record;
      }
      const otherSections = current.sections.filter((s) => s.url !== pageUrl);
      const merged = [...otherSections, ...liveSections];
      current.engine.index(merged);
      current.sections = merged;
      current.pagesCount = new Set(merged.map((s) => s.url)).size;
      this.setSiteIndex(domain, current);
      return current;
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
  var coordinator = new IndexerCoordinator(DEFAULT_CRAWL_CONFIG);
  function isDomainAllowed(domain) {
    const clean = domain.toLowerCase();
    return !BLOCKED_DOMAINS.some((b) => clean === b || clean.endsWith(`.${b}`));
  }
  async function discoverSeedUrls(originUrl, domain, signal) {
    const seeds = [];
    const baseOrigin = new URL(originUrl).origin;
    try {
      const llmResp = await fetch(`${baseOrigin}/llms.txt`, {
        method: "GET",
        cache: "force-cache",
        signal
      });
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
      const sitemapResp = await fetch(`${baseOrigin}/sitemap.xml`, {
        method: "GET",
        cache: "force-cache",
        signal
      });
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
  async function fetchHtmlWithBudget(url, timeoutMs, maxBytesPerPage, parentSignal) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const abortListener = () => controller.abort();
    if (parentSignal) {
      if (parentSignal.aborted) return null;
      parentSignal.addEventListener("abort", abortListener);
    }
    try {
      const resp = await fetch(url, {
        method: "GET",
        headers: { "Accept": "text/html,application/xhtml+xml" },
        cache: "force-cache",
        signal: controller.signal
      });
      if (!resp.ok) return null;
      const contentType = resp.headers.get("content-type") || "";
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
        return null;
      }
      const contentLength = resp.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > maxBytesPerPage) {
        console.warn(`[Wayfindr] Skipping ${url}: content-length ${contentLength} exceeds limit`);
        return null;
      }
      if (!resp.body) {
        const text = await resp.text();
        return text.length <= maxBytesPerPage ? { html: text, finalUrl: resp.url } : null;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let totalBytes = 0;
      let html = "";
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
        parentSignal.removeEventListener("abort", abortListener);
      }
    }
  }
  async function crawlDomain(originUrl, signal, customConfig) {
    const config = { ...coordinator.getConfig(), ...customConfig };
    const urlObj = new URL(originUrl);
    const domain = urlObj.hostname;
    if (!isDomainAllowed(domain)) {
      console.log(`[Wayfindr] Skipping blocked domain: ${domain}`);
      return [];
    }
    const isHomepage = urlObj.pathname === "/" || urlObj.pathname === "" || urlObj.pathname === "/index.html";
    const maxDepth = isHomepage ? config.maxDepth : 1;
    console.log(`[Wayfindr] Starting bounded crawl for: ${domain} (MaxPages: ${config.maxPages}, Concurrency: ${config.concurrency})`);
    const visitedUrls = /* @__PURE__ */ new Set();
    const queue = [];
    const originClean = originUrl.split("#")[0].replace(/\/$/, "");
    queue.push({ url: originClean, depth: 0, score: 999 });
    try {
      const seedUrls = await discoverSeedUrls(originUrl, domain, signal);
      for (const seed of seedUrls.slice(0, 30)) {
        if (seed !== originClean) {
          queue.push({ url: seed.replace(/\/$/, ""), depth: 1, score: 85 });
        }
      }
    } catch {
    }
    const allSections = [];
    let totalBytesCrawled = 0;
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
        if (fetchRes.finalUrl && !isValidCrawlUrl(fetchRes.finalUrl, domain)) {
          console.warn(`[Wayfindr] Crawl redirect to untrusted origin blocked: ${fetchRes.finalUrl}`);
          continue;
        }
        totalBytesCrawled += fetchRes.html.length;
        const pageSections = extractSectionsFromHtml(fetchRes.html, item.url, domain);
        allSections.push(...pageSections);
        if (item.depth < maxDepth && visitedUrls.size < config.maxPages) {
          const discoveredLinks = extractValidInternalLinks(fetchRes.html, item.url, domain);
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
      }
    }
    const workerCount = Math.min(config.concurrency, 4);
    const workers = Array.from({ length: workerCount }, () => worker());
    await Promise.all(workers);
    console.log(`[Wayfindr] Crawled ${visitedUrls.size} pages, indexed ${allSections.length} sections for ${domain}`);
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        await chrome.storage.local.set({
          [`wayfindr_${domain}`]: {
            sections: allSections,
            timestamp: Date.now()
          }
        });
      }
    } catch (err) {
      console.warn("[Wayfindr] Failed to save index to storage:", err);
    }
    return allSections;
  }
  function initiateCrawl(originUrl) {
    const domain = new URL(originUrl).hostname;
    return coordinator.registerActiveCrawl(domain, (signal) => {
      return crawlDomain(originUrl, signal, coordinator.getConfig());
    });
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "PAGE_LOADED") {
      const url = message.url;
      const liveSections = message.liveSections || [];
      try {
        const domain = new URL(url).hostname;
        if (!isDomainAllowed(domain)) {
          sendResponse({ status: "IGNORED" });
          return false;
        }
        if (liveSections.length > 0) {
          coordinator.mergeLivePageSections(domain, url, liveSections);
        }
        coordinator.ensureIndexLoaded(domain).then(({ record, state }) => {
          if (state === "READY") {
            sendResponse({ status: "READY", count: record?.sections.length || 0 });
          } else if (state === "STALE") {
            initiateCrawl(url).catch(() => {
            });
            sendResponse({ status: "STALE", count: record?.sections.length || 0 });
          } else if (state === "INDEXING" || state === "REINDEXING") {
            sendResponse({ status: state, count: record?.sections.length || 0 });
          } else {
            initiateCrawl(url).then((sections) => {
              sendResponse({ status: "CRAWLED", count: sections.length });
            }).catch((err) => {
              sendResponse({ status: "ERROR", error: String(err) });
            });
          }
        });
        return true;
      } catch (e) {
        console.error("[Wayfindr] Invalid URL in PAGE_LOADED:", e);
        sendResponse({ status: "ERROR" });
        return false;
      }
    }
    if (message.action === "SEARCH_QUERY") {
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
        return true;
      } catch {
        sendResponse({ results: [], status: "ERROR" });
        return false;
      }
    }
    if (message.action === "TRIGGER_REINDEX") {
      const { url } = message;
      try {
        const domain = new URL(url).hostname;
        coordinator.cancelActiveCrawl(domain);
        initiateCrawl(url).then((sections) => {
          sendResponse({ status: "DONE", sectionsCount: sections.length });
        }).catch((err) => {
          sendResponse({ status: "ERROR", error: String(err) });
        });
        return true;
      } catch (err) {
        sendResponse({ status: "ERROR", error: String(err) });
        return false;
      }
    }
    if (message.action === "GET_STATE") {
      const { url } = message;
      try {
        const domain = new URL(url).hostname;
        const state = coordinator.getState(domain);
        const record = coordinator.getSiteIndex(domain);
        sendResponse({ state, count: record?.sections.length || 0 });
        return false;
      } catch {
        sendResponse({ state: "UNINDEXED", count: 0 });
        return false;
      }
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
