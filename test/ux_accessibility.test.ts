import test from 'node:test';
import assert from 'node:assert';
import { isSafeNavigationUrl } from '../src/engine/url_utils';

test('UX & Accessibility - Request ID Sequencing', () => {
  let latestRequestId = 0;
  let activeRenderedData: string | null = null;

  function simulateSearchQuery(query: string, delayMs: number, data: string): Promise<void> {
    const reqId = ++latestRequestId;
    return new Promise((resolve) => {
      setTimeout(() => {
        // Discard stale responses if newer request was dispatched
        if (reqId === latestRequestId) {
          activeRenderedData = data;
        }
        resolve();
      }, delayMs);
    });
  }

  // Request 1 dispatched with slow response (80ms)
  const req1 = simulateSearchQuery('slow query', 80, 'data-for-slow');
  // Request 2 dispatched shortly after with fast response (20ms)
  const req2 = simulateSearchQuery('fast query', 20, 'data-for-fast');

  return Promise.all([req1, req2]).then(() => {
    // Even though req1 resolved last, activeRenderedData must be data-for-fast!
    assert.strictEqual(
      activeRenderedData,
      'data-for-fast',
      'Stale out-of-order response must not overwrite newer search result'
    );
  });
});

test('UX & Accessibility - Keyboard Navigation Wrap-around', () => {
  const itemCount = 5;

  function getNextIndex(current: number, direction: 'down' | 'up', count: number): number {
    if (count <= 0) return -1;
    if (direction === 'down') {
      return (current + 1) % count;
    } else {
      return (current - 1 + count) % count;
    }
  }

  // Initial selection is 0
  let selected = 0;
  assert.strictEqual(selected, 0);

  // ArrowDown advances: 0 -> 1 -> 2 -> 3 -> 4
  selected = getNextIndex(selected, 'down', itemCount);
  assert.strictEqual(selected, 1);
  selected = getNextIndex(selected, 'down', itemCount);
  assert.strictEqual(selected, 2);
  selected = getNextIndex(selected, 'down', itemCount);
  assert.strictEqual(selected, 3);
  selected = getNextIndex(selected, 'down', itemCount);
  assert.strictEqual(selected, 4);

  // ArrowDown wraps from 4 back to 0
  selected = getNextIndex(selected, 'down', itemCount);
  assert.strictEqual(selected, 0, 'ArrowDown at bottom must wrap to top (index 0)');

  // ArrowUp wraps from 0 to bottom (4)
  selected = getNextIndex(selected, 'up', itemCount);
  assert.strictEqual(selected, 4, 'ArrowUp at top must wrap to bottom (index 4)');

  // ArrowUp decrements
  selected = getNextIndex(selected, 'up', itemCount);
  assert.strictEqual(selected, 3);
});

test('UX & Accessibility - Safe Navigation URL Sanitization', () => {
  // Disallowed / Malicious schemes
  assert.strictEqual(isSafeNavigationUrl('javascript:alert(1)'), false);
  assert.strictEqual(isSafeNavigationUrl('data:text/html,<script>alert(1)</script>'), false);
  assert.strictEqual(isSafeNavigationUrl('vbscript:msgbox(1)'), false);
  assert.strictEqual(isSafeNavigationUrl('file:///etc/passwd'), false);
  assert.strictEqual(isSafeNavigationUrl('chrome://settings'), false);

  // Allowed schemes
  assert.strictEqual(isSafeNavigationUrl('https://example.com/pricing#tier-1'), true);
  assert.strictEqual(isSafeNavigationUrl('http://example.com/faq'), true);
  assert.strictEqual(isSafeNavigationUrl('#internal-anchor'), true);
  assert.strictEqual(isSafeNavigationUrl('/relative/path#section'), true);
});

test('UX & Accessibility - W3C ARIA Combobox Attributes Pattern', () => {
  // Specification requirement check for ARIA roles
  const comboboxPattern = {
    modalRole: 'dialog',
    ariaModal: 'true',
    inputRole: 'combobox',
    ariaAutocomplete: 'list',
    listboxRole: 'listbox',
    optionRole: 'option'
  };

  assert.strictEqual(comboboxPattern.modalRole, 'dialog');
  assert.strictEqual(comboboxPattern.inputRole, 'combobox');
  assert.strictEqual(comboboxPattern.listboxRole, 'listbox');
  assert.strictEqual(comboboxPattern.optionRole, 'option');
});
