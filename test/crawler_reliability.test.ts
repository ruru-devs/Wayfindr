import { describe, it } from 'node:test';
import assert from 'node:assert';
import { IndexerCoordinator, DEFAULT_CRAWL_CONFIG } from '../src/background/indexer_coordinator';
import { SectionNode } from '../src/engine/types';

describe('Phase 1B: Crawler Reliability & Indexer Coordinator', () => {
  it('initializes with sensible, bounded crawl budget defaults', () => {
    const coordinator = new IndexerCoordinator();
    const config = coordinator.getConfig();

    assert.strictEqual(config.maxPages, 30);
    assert.strictEqual(config.maxDepth, 2);
    assert.strictEqual(config.concurrency, 3);
    assert.strictEqual(config.maxBytesPerPage, 1024 * 1024); // 1 MB
    assert.strictEqual(config.maxBytesPerSite, 10 * 1024 * 1024); // 10 MB
    assert.strictEqual(config.requestTimeoutMs, 8000); // 8s
    assert.strictEqual(config.cacheTtlMs, 24 * 60 * 60 * 1000); // 24h
  });

  it('manages state lifecycle UNINDEXED -> INDEXING -> READY', async () => {
    const coordinator = new IndexerCoordinator();
    const domain = 'clinic.org';

    assert.strictEqual(coordinator.getState(domain), 'UNINDEXED');

    let crawlStarted = false;
    const crawlPromise = coordinator.registerActiveCrawl(domain, async (signal) => {
      crawlStarted = true;
      assert.strictEqual(signal.aborted, false);
      return [
        {
          id: 'sec_1',
          url: 'https://clinic.org/about',
          pageTitle: 'About Us',
          title: 'Clinic Mission',
          snippet: 'Providing premier medical service.'
        }
      ];
    });

    assert.strictEqual(coordinator.getState(domain), 'INDEXING');
    assert.strictEqual(crawlStarted, true);

    const sections = await crawlPromise;
    assert.strictEqual(sections.length, 1);
    assert.strictEqual(coordinator.getState(domain), 'READY');

    const record = coordinator.getSiteIndex(domain);
    assert.ok(record);
    assert.strictEqual(record?.sections.length, 1);
  });

  it('deduplicates concurrent crawl triggers from multiple tabs on the same origin', async () => {
    const coordinator = new IndexerCoordinator();
    const domain = 'news.org';

    let factoryInvocations = 0;

    const job1 = coordinator.registerActiveCrawl(domain, async () => {
      factoryInvocations++;
      await new Promise(r => setTimeout(r, 50));
      return [{ id: 'sec_1', url: 'https://news.org/page', pageTitle: 'Page', title: 'News', snippet: 'Text' }];
    });

    const job2 = coordinator.registerActiveCrawl(domain, async () => {
      factoryInvocations++;
      return [];
    });

    // Both promises should resolve to the exact same result from job1
    const [res1, res2] = await Promise.all([job1, job2]);
    assert.strictEqual(factoryInvocations, 1);
    assert.strictEqual(res1, res2);
    assert.strictEqual(res1.length, 1);
  });

  it('cancels active crawl via AbortSignal when requested', async () => {
    const coordinator = new IndexerCoordinator();
    const domain = 'slowsite.com';

    let signalAborted = false;

    const crawlPromise = coordinator.registerActiveCrawl(domain, async (signal) => {
      return new Promise<SectionNode[]>((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve([{ id: 'slow', url: 'https://slowsite.com', pageTitle: 'Slow', title: 'Slow', snippet: 'Slow' }]);
        }, 500);

        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          signalAborted = true;
          reject(new Error('AbortError'));
        });
      });
    });

    assert.strictEqual(coordinator.hasActiveCrawl(domain), true);
    coordinator.cancelActiveCrawl(domain);

    await assert.rejects(crawlPromise, /AbortError/);
    assert.strictEqual(signalAborted, true);
    assert.strictEqual(coordinator.getState(domain), 'UNINDEXED');
    assert.strictEqual(coordinator.hasActiveCrawl(domain), false);
  });

  it('replaces outdated page sections upon re-indexing instead of accumulating duplicates', () => {
    const coordinator = new IndexerCoordinator();
    const domain = 'store.com';

    // Initial index with 2 pages
    const initialSections: SectionNode[] = [
      { id: 'page1_old', url: 'https://store.com/page1', pageTitle: 'P1', title: 'Old P1', snippet: 'Old P1' },
      { id: 'page2_stay', url: 'https://store.com/page2', pageTitle: 'P2', title: 'Stay P2', snippet: 'Stay P2' }
    ];

    coordinator.mergeLivePageSections(domain, 'https://store.com/page1', [initialSections[0]]);
    coordinator.mergeLivePageSections(domain, 'https://store.com/page2', [initialSections[1]]);

    let current = coordinator.getSiteIndex(domain)!;
    assert.strictEqual(current.sections.length, 2);

    // Re-index page 1 with updated content
    const updatedP1: SectionNode = {
      id: 'page1_new',
      url: 'https://store.com/page1',
      pageTitle: 'P1 Updated',
      title: 'New P1 Title',
      snippet: 'New P1 Snippet'
    };

    coordinator.mergeLivePageSections(domain, 'https://store.com/page1', [updatedP1]);

    current = coordinator.getSiteIndex(domain)!;
    assert.strictEqual(current.sections.length, 2); // 1 for page 1, 1 for page 2; NOT 3!

    const ids = current.sections.map(s => s.id);
    assert.ok(ids.includes('page1_new'));
    assert.ok(!ids.includes('page1_old'));
    assert.ok(ids.includes('page2_stay'));
  });

  it('detects cache staleness when TTL expires', async () => {
    // Coordinator with 10ms TTL for testing
    const coordinator = new IndexerCoordinator({ cacheTtlMs: 10 });
    const domain = 'stale-test.org';

    coordinator.mergeLivePageSections(domain, 'https://stale-test.org/home', [
      { id: 'sec_home', url: 'https://stale-test.org/home', pageTitle: 'H', title: 'Home', snippet: 'Text' }
    ]);

    assert.strictEqual(coordinator.getState(domain), 'READY');

    // Wait past TTL
    await new Promise(r => setTimeout(r, 20));

    const { state } = await coordinator.ensureIndexLoaded(domain);
    assert.strictEqual(state, 'STALE');
  });
});
