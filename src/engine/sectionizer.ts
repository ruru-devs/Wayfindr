import { SectionNode } from './types';

/**
 * Parses raw HTML string or Document into distinct semantic sections,
 * extracting anchor IDs, action links, prices, and timings.
 */
export function extractSectionsFromHtml(
  htmlContent: string,
  pageUrl: string,
  pageDocTitle: string
): SectionNode[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, 'text/html');

  // Strip noise
  doc.querySelectorAll('script, style, svg, noscript, iframe, nav, footer').forEach(el => el.remove());

  const sections: SectionNode[] = [];
  const candidates: HTMLElement[] = [];

  // Find explicit sections, articles, or divs with IDs
  doc.querySelectorAll('section, article, div[id], main, [role="region"]').forEach(el => {
    candidates.push(el as HTMLElement);
  });

  // If few semantic elements, group around headings
  if (candidates.length < 3) {
    doc.querySelectorAll('h1, h2, h3').forEach(h => {
      const parent = h.parentElement;
      if (parent && !candidates.includes(parent)) {
        candidates.push(parent as HTMLElement);
      }
    });
  }

  let idx = 0;
  for (const block of candidates) {
    // Firefox XML/DOM documents can return undefined for innerText; textContent is standard
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
      } catch {
        // Keep as-is
      }
    }

    // Metadata extraction
    const priceMatch = text.match(/(?:₹|\$|USD|INR|Rs\.?)\s*([\d,]+(?:\.\d+)?)/i);
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

  return sections;
}

/**
 * Extracts and filters internal links from a page, excluding external sites,
 * social links, file downloads, and auth routes.
 */
export function extractValidInternalLinks(
  htmlContent: string,
  baseUrl: string,
  originDomain: string
): string[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, 'text/html');
  const anchors = doc.querySelectorAll('a[href]');
  const validUrls = new Set<string>();

  const ignoreRegex = /\.(pdf|zip|rar|jpg|jpeg|png|gif|svg|mp4|exe|apk|dmg|iso)$/i;
  const skipPathRegex = /\b(login|logout|signin|signup|cart|checkout|auth|oauth|share|facebook|twitter|instagram|linkedin|youtube)\b/i;

  anchors.forEach(a => {
    try {
      const rawHref = a.getAttribute('href');
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) {
        return;
      }

      const resolved = new URL(rawHref, baseUrl);
      
      // Must be same origin/domain
      if (resolved.hostname !== originDomain && !resolved.hostname.endsWith(`.${originDomain}`)) {
        return;
      }

      // Check file extensions & skip paths
      if (ignoreRegex.test(resolved.pathname) || skipPathRegex.test(resolved.pathname)) {
        return;
      }

      // Strip query parameters and hashes for canonical crawling
      const cleanUrl = `${resolved.origin}${resolved.pathname}`.replace(/\/$/, '');
      if (cleanUrl !== baseUrl.replace(/\/$/, '')) {
        validUrls.add(cleanUrl);
      }
    } catch {
      // Ignore malformed URLs
    }
  });

  return Array.from(validUrls);
}
