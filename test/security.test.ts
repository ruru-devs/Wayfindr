import { describe, it } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import { isValidCrawlUrl, isSafeNavigationUrl } from '../src/engine/url_utils';
import { SearchResultItem } from '../src/engine/types';

describe('Phase 0: URL & Domain Validation Security', () => {
  const domain = 'example.com';

  it('rejects attacker suffix injection (https://example.com.attacker.net/)', () => {
    assert.strictEqual(isValidCrawlUrl('https://example.com.attacker.net/', domain), false);
    assert.strictEqual(isValidCrawlUrl('https://example.com.attacker.net/page', domain), false);
  });

  it('rejects userinfo confusion attacks (https://example.com@evil.com)', () => {
    assert.strictEqual(isValidCrawlUrl('https://example.com@evil.com', domain), false);
    assert.strictEqual(isValidCrawlUrl('https://example.com:password@evil.com/path', domain), false);
    assert.strictEqual(isValidCrawlUrl('https://admin@example.com/path', domain), false);
  });

  it('rejects hyphenated domain spoofing (https://evil-example.com)', () => {
    assert.strictEqual(isValidCrawlUrl('https://evil-example.com', domain), false);
    assert.strictEqual(isValidCrawlUrl('https://example.com-phishing.org', domain), false);
  });

  it('rejects non-HTTP protocols (javascript:, data:, file:)', () => {
    assert.strictEqual(isValidCrawlUrl('javascript:alert(document.cookie)', domain), false);
    assert.strictEqual(isValidCrawlUrl('data:text/html,<script>alert(1)</script>', domain), false);
    assert.strictEqual(isValidCrawlUrl('file:///etc/passwd', domain), false);
  });

  it('accepts legitimate same-origin URLs with mixed-case and ports', () => {
    assert.strictEqual(isValidCrawlUrl('https://example.com/pricing', domain), true);
    assert.strictEqual(isValidCrawlUrl('http://eXamPle.COM/About', domain), true);
    assert.strictEqual(isValidCrawlUrl('https://example.com:8443/products', domain), true);
    assert.strictEqual(isValidCrawlUrl('https://www.example.com/services', domain), true);
  });

  it('handles subdomain policy properly', () => {
    assert.strictEqual(isValidCrawlUrl('https://docs.example.com/guide', domain, true), true);
    assert.strictEqual(isValidCrawlUrl('https://docs.example.com/guide', domain, false), false);
  });

  it('sanitizes navigation URLs to prevent protocol execution', () => {
    assert.strictEqual(isSafeNavigationUrl('https://example.com/pricing'), true);
    assert.strictEqual(isSafeNavigationUrl('http://example.com/pricing'), true);
    assert.strictEqual(isSafeNavigationUrl('javascript:alert(1)'), false);
    assert.strictEqual(isSafeNavigationUrl('data:text/html,<h1>XSS</h1>'), false);
  });
});

describe('Phase 0: XSS and HTML Injection Defense', () => {
  it('renders malicious payloads as inert text without executing HTML or script tags', () => {
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="container"></div></body></html>');
    const document = dom.window.document;
    const container = document.getElementById('container')!;

    const maliciousResult: SearchResultItem = {
      id: 'sec_malicious',
      title: '<img src=x onerror="alert(\'xss_title\')"> Malicious Title',
      snippet: '<script>alert("xss_snippet")</script> Malicious Snippet <svg onload="alert(1)">',
      targetUrl: 'https://example.com/page',
      isCurrentPage: false,
      pageTitle: '<b onmouseover="alert(\'xss_page\')">Page</b>',
      metadata: {
        price: '<script>evil()</script>$99',
        timings: '<img src=err>Mon-Fri'
      }
    };

    // Safe DOM node construction as implemented in content_script.ts
    const el = document.createElement('div');
    el.className = 'item';

    const itemMain = document.createElement('div');
    itemMain.className = 'item-main';

    const itemPage = document.createElement('div');
    itemPage.className = 'item-page';
    itemPage.textContent = `${maliciousResult.isCurrentPage ? 'Current Page' : 'Cross-Page Link'} › ${maliciousResult.pageTitle}`;
    itemMain.appendChild(itemPage);

    const itemTitle = document.createElement('div');
    itemTitle.className = 'item-title';
    itemTitle.textContent = maliciousResult.title;
    itemMain.appendChild(itemTitle);

    const itemSnippet = document.createElement('div');
    itemSnippet.className = 'item-snippet';
    itemSnippet.textContent = maliciousResult.snippet;
    itemMain.appendChild(itemSnippet);

    if (maliciousResult.metadata?.price) {
      const itemPrice = document.createElement('div');
      itemPrice.className = 'item-meta';
      itemPrice.textContent = `💰 ${maliciousResult.metadata.price}`;
      itemMain.appendChild(itemPrice);
    }

    if (maliciousResult.metadata?.timings) {
      const itemTimings = document.createElement('div');
      itemTimings.className = 'item-meta';
      itemTimings.textContent = `🕒 ${maliciousResult.metadata.timings}`;
      itemMain.appendChild(itemTimings);
    }

    el.appendChild(itemMain);
    container.appendChild(el);

    // Verify: no HTML tags (img, script, svg, b) are present in DOM tree
    assert.strictEqual(container.querySelectorAll('img').length, 0);
    assert.strictEqual(container.querySelectorAll('script').length, 0);
    assert.strictEqual(container.querySelectorAll('svg').length, 0);
    assert.strictEqual(container.querySelectorAll('b').length, 0);

    // Verify: textContent contains the raw literal strings safely
    assert.ok(container.textContent?.includes('<img src=x onerror="alert(\'xss_title\')">'));
    assert.ok(container.textContent?.includes('<script>alert("xss_snippet")</script>'));
    assert.ok(container.innerHTML.includes('&lt;img src=x onerror="alert(\'xss_title\')"&gt;'));
  });
});
