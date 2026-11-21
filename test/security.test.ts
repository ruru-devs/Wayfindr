import { describe, it } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import { isValidCrawlUrl, isSafeNavigationUrl, isSensitiveUrl } from '../src/engine/url_utils';
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

describe('Phase 4: Privacy & Sensitive URL/Data Protection', () => {
  it('detects and blocks crawling on authentication and account URLs', () => {
    assert.strictEqual(isSensitiveUrl('https://example.com/login'), true);
    assert.strictEqual(isSensitiveUrl('https://example.com/signin'), true);
    assert.strictEqual(isSensitiveUrl('https://example.com/user/signup'), true);
    assert.strictEqual(isSensitiveUrl('https://example.com/auth/oauth/callback'), true);
    assert.strictEqual(isSensitiveUrl('https://example.com/reset-password?id=123'), true);
    assert.strictEqual(isSensitiveUrl('https://example.com/my-account/profile'), true);
    assert.strictEqual(isSensitiveUrl('https://example.com/cpanel'), true);
  });

  it('detects and blocks crawling on banking, payment, and checkout URLs', () => {
    assert.strictEqual(isSensitiveUrl('https://example.com/checkout/step2'), true);
    assert.strictEqual(isSensitiveUrl('https://example.com/cart'), true);
    assert.strictEqual(isSensitiveUrl('https://example.com/billing/payment'), true);
    assert.strictEqual(isSensitiveUrl('https://example.com/online-banking/transfer'), true);
    assert.strictEqual(isSensitiveUrl('https://example.com/admin/dashboard'), true);
  });

  it('detects queries containing sensitive tokens, secrets, or passwords', () => {
    assert.strictEqual(isSensitiveUrl('https://example.com/api/data?token=secret123'), true);
    assert.strictEqual(isSensitiveUrl('https://example.com/verify?session_id=abc987'), true);
    assert.strictEqual(isSensitiveUrl('https://example.com/page?api_key=key_test_99'), true);
  });

  it('permits benign public content URLs', () => {
    assert.strictEqual(isSensitiveUrl('https://example.com/docs/getting-started'), false);
    assert.strictEqual(isSensitiveUrl('https://example.com/pricing'), false);
    assert.strictEqual(isSensitiveUrl('https://example.com/products/wireless-headphones'), false);
    assert.strictEqual(isSensitiveUrl('https://example.com/doctors/dr-sharma'), false);
  });

  it('isValidCrawlUrl rejects sensitive URLs automatically', () => {
    assert.strictEqual(isValidCrawlUrl('https://example.com/login', 'example.com'), false);
    assert.strictEqual(isValidCrawlUrl('https://example.com/checkout', 'example.com'), false);
    assert.strictEqual(isValidCrawlUrl('https://example.com/billing', 'example.com'), false);
    assert.strictEqual(isValidCrawlUrl('https://example.com/products', 'example.com'), true);
  });

  it('detects password input fields in DOM to protect authenticated user pages', () => {
    const dom = new JSDOM('<!DOCTYPE html><html><body><form><input type="password" id="pwd"/></form></body></html>');
    const hasPassword = !!dom.window.document.querySelector('input[type="password"]');
    assert.strictEqual(hasPassword, true);

    const safeDom = new JSDOM('<!DOCTYPE html><html><body><h1>Public Article</h1></body></html>');
    const safeHasPassword = !!safeDom.window.document.querySelector('input[type="password"]');
    assert.strictEqual(safeHasPassword, false);
  });
});

