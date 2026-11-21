import { SectionNode } from './types';
import { isValidCrawlUrl } from './url_utils';

/**
 * Parses raw HTML string or Document into distinct semantic sections,
 * extracting anchor IDs, action links, prices, and timings.
 */
/**
 * Parses raw HTML string or a live Document root into distinct semantic sections,
 * extracting anchor IDs, action links, navigation menus, prices, and timings.
 */
export function extractSectionsFromDoc(
  doc: Document | Element,
  pageUrl: string,
  pageDocTitle: string
): SectionNode[] {
  // Clone or work on elements without deleting nav/footer so links & menu sections are preserved
  const sections: SectionNode[] = [];
  const candidates: HTMLElement[] = [];

  // 1. Discover menu & navigation items (Solution C: preserve menus & categories)
  doc.querySelectorAll('nav a[href], header a[href], [role="navigation"] a[href]').forEach(a => {
    const text = (a.textContent || '').trim().replace(/\s+/g, ' ');
    const href = a.getAttribute('href');
    if (text.length >= 2 && text.length <= 60 && href && !href.startsWith('#') && !href.startsWith('javascript:')) {
      try {
        const fullUrl = new URL(href, pageUrl).href;
        sections.push({
          id: `menu_${sections.length + 1}`,
          url: fullUrl,
          pageTitle: `${pageDocTitle} › Navigation`,
          title: text,
          snippet: `Menu link: ${text} on ${pageDocTitle}`,
          actionLabel: 'Explore'
        });
      } catch {}
    }
  });

  // 2. Discover semantic body blocks (excluding raw scripts/styles)
  doc.querySelectorAll('section, article, div[id], main, [role="region"], [role="main"]').forEach(el => {
    // Skip if it's nav or script/style
    if (!el.closest('nav') && !['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG'].includes(el.tagName)) {
      candidates.push(el as HTMLElement);
    }
  });

  if (candidates.length < 3) {
    doc.querySelectorAll('h1, h2, h3').forEach(h => {
      const parent = h.parentElement;
      if (parent && !candidates.includes(parent) && !parent.closest('nav')) {
        candidates.push(parent as HTMLElement);
      }
    });
  }

  let idx = 0;
  for (const block of candidates) {
    const text = (block.textContent || '').trim().replace(/\s+/g, ' ');
    if (text.length < 25) continue;

    const heading = block.querySelector('h1, h2, h3, h4, h5');
    let title = (heading?.textContent || '').trim();
    if (!title) {
      const strong = block.querySelector('strong, b');
      title = (strong?.textContent || '').trim() || text.split(/\s+/).slice(0, 6).join(' ');
    }

    const anchorId = block.id || heading?.id || '';

    // Action button detection
    const actionEl = block.querySelector('a, button');
    let actionLabel = (actionEl?.textContent || '').trim();
    let actionUrl = actionEl?.getAttribute('href') || undefined;
    if (actionUrl && !actionUrl.startsWith('http') && !actionUrl.startsWith('#')) {
      try {
        actionUrl = new URL(actionUrl, pageUrl).href;
      } catch {}
    }

    // Metadata extraction
    const priceMatch = text.match(/(?:₹|\$|USD|INR|EUR|Rs\.?)\s*([\d,]+(?:\.\d+)?)/i);
    const timingsMatch = text.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)\s*-\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))/);

    idx++;
    sections.push({
      id: `sec_${idx}_${anchorId || 'block'}`,
      url: pageUrl,
      pageTitle: pageDocTitle || 'Page',
      anchorId: anchorId || undefined,
      title: title.slice(0, 100),
      snippet: text.slice(0, 200).replace(/\s+/g, ' '),
      actionLabel: actionLabel && actionLabel.length < 30 ? actionLabel : undefined,
      actionUrl,
      metadata: {
        price: priceMatch ? priceMatch[0] : undefined,
        timings: timingsMatch ? timingsMatch[0] : undefined
      }
    });
  }

  // Schema.org Structured Data (JSON-LD) extraction
  try {
    const jsonLdScripts = doc.querySelectorAll('script[type="application/ld+json"]');
    jsonLdScripts.forEach(script => {
      const parsed = JSON.parse(script.textContent || '{}');
      const items = Array.isArray(parsed) ? parsed : (parsed['@graph'] || [parsed]);
      for (const item of items) {
        if (!item || !item['@type']) continue;
        const schemaType = String(item['@type']);
        const schemaName = item.name || item.headline || item.title || '';
        const schemaDesc = item.description || item.articleBody || '';
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
              timings: item.openingHours || item.openingHoursSpecification ? JSON.stringify(item.openingHours || item.openingHoursSpecification) : undefined
            }
          });
        }
      }
    });
  } catch {}

  return sections;
}

export function extractSectionsFromHtml(
  htmlContent: string,
  pageUrl: string,
  pageDocTitle: string
): SectionNode[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, 'text/html');
  return extractSectionsFromDoc(doc, pageUrl, pageDocTitle);
}

/**
 * Heuristic priority scorer for internal links:
 * High score = high value (pricing, docs, services, about, specs, return policy)
 * Negative score = discard or deprioritize (year=, tag/, page=, date archives)
 */
export function scoreLinkPriority(pathname: string, search: string): number {
  let score = 50; // base score

  const lowPriorityRegex = /(?:[?&](?:page|p|year|month|date|replytocom|filter|sort|order)=|\/(?:tag|category|author|page|archive|20\d\d)\/)/i;
  if (lowPriorityRegex.test(pathname) || lowPriorityRegex.test(search)) {
    return -100; // ignore/prune
  }

  const highPriorityKeywords = [
    { pattern: /\b(pricing|price|fees|plans|rates)\b/i, boost: 40 },
    { pattern: /\b(docs|documentation|guide|manual|specs|specification|features)\b/i, boost: 35 },
    { pattern: /\b(service|services|departments|specialties|treatments|doctors|physicians|team)\b/i, boost: 30 },
    { pattern: /\b(policy|policies|returns|refund|warranty|shipping|faq|help|terms)\b/i, boost: 30 },
    { pattern: /\b(about|contact|location|hours|timings|admission|schedule|book|appointment)\b/i, boost: 25 },
    { pattern: /\b(products|shop|catalog|courses|programs)\b/i, boost: 20 },
  ];

  for (const { pattern, boost } of highPriorityKeywords) {
    if (pattern.test(pathname)) {
      score += boost;
    }
  }

  // Shorter, cleaner directory paths are usually higher in navigation hierarchy
  const depth = (pathname.match(/\//g) || []).length;
  if (depth <= 2) score += 15;
  else if (depth > 4) score -= 15;

  return score;
}

/**
 * Extracts and filters internal links from a page, excluding external sites,
 * social links, file downloads, auth routes, and low-priority archives (year=, tag/, page=).
 */
export function extractValidInternalLinks(
  htmlContent: string,
  baseUrl: string,
  originDomain: string
): { url: string; score: number }[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, 'text/html');
  const anchors = doc.querySelectorAll('a[href]');
  const discoveredMap = new Map<string, number>();

  const ignoreExtRegex = /\.(pdf|zip|rar|tar|gz|jpg|jpeg|png|gif|svg|webp|mp4|webm|exe|apk|dmg|iso|css|js)$/i;
  const skipPathRegex = /\b(login|logout|signin|signup|cart|checkout|auth|oauth|share|facebook|twitter|instagram|linkedin|youtube|pinterest)\b/i;

  anchors.forEach(a => {
    try {
      const rawHref = a.getAttribute('href');
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) {
        return;
      }

      const resolved = new URL(rawHref, baseUrl);
      
      // Must be valid internal domain/subdomain
      if (!isValidCrawlUrl(resolved.href, originDomain)) {
        return;
      }

      // Check file extensions & skip paths
      if (ignoreExtRegex.test(resolved.pathname) || skipPathRegex.test(resolved.pathname)) {
        return;
      }

      const priority = scoreLinkPriority(resolved.pathname, resolved.search);
      if (priority < 0) {
        return; // Filter out low-priority pagination/archive links
      }

      // Strip trailing slashes & hash
      const cleanUrl = `${resolved.origin}${resolved.pathname}`.replace(/\/$/, '');
      if (cleanUrl !== baseUrl.replace(/\/$/, '')) {
        const existingScore = discoveredMap.get(cleanUrl);
        if (existingScore === undefined || priority > existingScore) {
          discoveredMap.set(cleanUrl, priority);
        }
      }
    } catch {
      // Ignore malformed URLs
    }
  });

  return Array.from(discoveredMap.entries())
    .map(([url, score]) => ({ url, score }))
    .sort((a, b) => b.score - a.score);
}
