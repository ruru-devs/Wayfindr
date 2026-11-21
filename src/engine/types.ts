export interface SectionNode {
  id: string;
  url: string;
  pageTitle: string;
  anchorId?: string;
  title: string;
  snippet: string;
  actionLabel?: string;
  actionUrl?: string;
  metadata?: {
    price?: string;
    timings?: string;
    [key: string]: any;
  };
}

export interface SearchResultItem extends SectionNode {
  score: number;
  matchType: 'exact_keyword' | 'semantic' | 'title';
  targetUrl: string;
  isCurrentPage: boolean;
}

export interface CrawlJob {
  domain: string;
  originUrl: string;
  discoveredSections: SectionNode[];
  status: 'idle' | 'crawling' | 'ready';
  indexedPagesCount: number;
  timestamp: number;
}
