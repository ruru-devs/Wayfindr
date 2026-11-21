/**
 * Wayfindr Indexing Coordinator & State Machine
 * Manages crawl lifecycle, concurrency locking, cache staleness, and state transitions.
 */

import { SectionNode } from '../engine/types';
import { ClientBM25Engine } from '../engine/bm25';

export type IndexState = 'UNINDEXED' | 'INDEXING' | 'READY' | 'STALE' | 'REINDEXING';

export interface CrawlBudgetConfig {
  maxPages: number;
  maxDepth: number;
  maxBytesPerSite: number;
  maxBytesPerPage: number;
  requestTimeoutMs: number;
  concurrency: number;
  cacheTtlMs: number;
}

export const DEFAULT_CRAWL_CONFIG: CrawlBudgetConfig = {
  maxPages: 30,
  maxDepth: 2,
  maxBytesPerSite: 10 * 1024 * 1024, // 10 MB total
  maxBytesPerPage: 1024 * 1024,       // 1 MB per page
  requestTimeoutMs: 8000,             // 8 seconds
  concurrency: 3,
  cacheTtlMs: 24 * 60 * 60 * 1000     // 24 hours
};

export interface SiteIndexRecord {
  engine: ClientBM25Engine;
  sections: SectionNode[];
  timestamp: number;
  pagesCount: number;
}

export class IndexerCoordinator {
  private inMemoryIndices = new Map<string, SiteIndexRecord>();
  private activeCrawlJobs = new Map<string, { promise: Promise<SectionNode[]>; abortController: AbortController }>();
  private domainStates = new Map<string, IndexState>();
  private config: CrawlBudgetConfig;

  constructor(config: Partial<CrawlBudgetConfig> = {}) {
    this.config = { ...DEFAULT_CRAWL_CONFIG, ...config };
  }

  public getConfig(): CrawlBudgetConfig {
    return this.config;
  }

  public getState(domain: string): IndexState {
    return this.domainStates.get(domain) || 'UNINDEXED';
  }

  public setState(domain: string, state: IndexState) {
    this.domainStates.set(domain, state);
    // Asynchronously broadcast/persist state
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({ [`wayfindr_state_${domain}`]: state }).catch(() => {});
      }
    } catch {}
  }

  public getSiteIndex(domain: string): SiteIndexRecord | undefined {
    return this.inMemoryIndices.get(domain);
  }

  public setSiteIndex(domain: string, record: SiteIndexRecord) {
    this.inMemoryIndices.set(domain, record);
    this.setState(domain, 'READY');
  }

  public hasActiveCrawl(domain: string): boolean {
    return this.activeCrawlJobs.has(domain);
  }

  public getActiveCrawl(domain: string): Promise<SectionNode[]> | undefined {
    return this.activeCrawlJobs.get(domain)?.promise;
  }

  public registerActiveCrawl(
    domain: string,
    crawlPromiseFactory: (signal: AbortSignal) => Promise<SectionNode[]>
  ): Promise<SectionNode[]> {
    // If a crawl is already running for this domain, return the existing in-flight promise
    const existing = this.activeCrawlJobs.get(domain);
    if (existing) {
      console.log(`[Coordinator] Multiple tabs requested crawl for ${domain}; attaching to active job.`);
      return existing.promise;
    }

    const abortController = new AbortController();
    const isReindex = this.inMemoryIndices.has(domain);
    this.setState(domain, isReindex ? 'REINDEXING' : 'INDEXING');

    const promise = crawlPromiseFactory(abortController.signal)
      .then(sections => {
        const engine = new ClientBM25Engine();
        engine.index(sections);
        const record: SiteIndexRecord = {
          engine,
          sections,
          timestamp: Date.now(),
          pagesCount: new Set(sections.map(s => s.url)).size
        };
        this.setSiteIndex(domain, record);
        this.setState(domain, 'READY');
        return sections;
      })
      .catch(err => {
        if (abortController.signal.aborted) {
          console.log(`[Coordinator] Crawl for ${domain} was cancelled.`);
        } else {
          console.error(`[Coordinator] Crawl failed for ${domain}:`, err);
        }
        // Fallback to STALE or UNINDEXED
        this.setState(domain, this.inMemoryIndices.has(domain) ? 'STALE' : 'UNINDEXED');
        throw err;
      })
      .finally(() => {
        this.activeCrawlJobs.delete(domain);
      });

    this.activeCrawlJobs.set(domain, { promise, abortController });
    return promise;
  }

  public cancelActiveCrawl(domain: string) {
    const job = this.activeCrawlJobs.get(domain);
    if (job) {
      job.abortController.abort();
      this.activeCrawlJobs.delete(domain);
      this.setState(domain, this.inMemoryIndices.has(domain) ? 'STALE' : 'UNINDEXED');
    }
  }

  /**
   * Rebuilds in-memory index from chrome.storage.local on demand
   * when service worker wakes up from idle termination.
   */
  public async ensureIndexLoaded(domain: string): Promise<{ record?: SiteIndexRecord; state: IndexState }> {
    // 1. In-memory check
    const memRecord = this.inMemoryIndices.get(domain);
    if (memRecord) {
      const isStale = Date.now() - memRecord.timestamp > this.config.cacheTtlMs;
      const state = isStale ? 'STALE' : 'READY';
      this.setState(domain, state);
      return { record: memRecord, state };
    }

    // 2. Storage revival
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        const key = `wayfindr_${domain}`;
        const res = await chrome.storage.local.get([key, `wayfindr_state_${domain}`]);
        const cached = res ? res[key] : null;

        if (cached && Array.isArray(cached.sections) && cached.sections.length > 0) {
          const engine = new ClientBM25Engine();
          engine.index(cached.sections);
          const isStale = Date.now() - (cached.timestamp || 0) > this.config.cacheTtlMs;
          const state: IndexState = isStale ? 'STALE' : 'READY';

          const record: SiteIndexRecord = {
            engine,
            sections: cached.sections,
            timestamp: cached.timestamp || Date.now(),
            pagesCount: new Set(cached.sections.map((s: SectionNode) => s.url)).size
          };

          this.inMemoryIndices.set(domain, record);
          this.setState(domain, state);
          return { record, state };
        }
      } catch (e) {
        console.warn(`[Coordinator] Error reviving cache for ${domain}:`, e);
      }
    }

    return { record: undefined, state: 'UNINDEXED' };
  }

  /**
   * Replaces sections belonging to a specific page rather than accumulating duplicates.
   */
  public mergeLivePageSections(domain: string, pageUrl: string, liveSections: SectionNode[]): SiteIndexRecord {
    const current = this.inMemoryIndices.get(domain);
    if (!current) {
      const engine = new ClientBM25Engine();
      engine.index(liveSections);
      const record: SiteIndexRecord = {
        engine,
        sections: liveSections,
        timestamp: Date.now(),
        pagesCount: 1
      };
      this.setSiteIndex(domain, record);
      return record;
    }

    // Cleanly replace old sections from the exact same pageUrl
    const otherSections = current.sections.filter(s => s.url !== pageUrl);
    const merged = [...otherSections, ...liveSections];
    current.engine.index(merged);
    current.sections = merged;
    current.pagesCount = new Set(merged.map(s => s.url)).size;
    this.setSiteIndex(domain, current);
    return current;
  }
}
