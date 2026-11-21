import { SectionNode, SearchResultItem } from './types';
import { normalizeAndTokenize, expandQuery, stemToken } from './normalizer';

/**
 * Tunable Ranking Weights & Thresholds
 */
export const RANKING_WEIGHTS = {
  bm25: 1.0,
  exactPhraseTitle: 14.0,
  partialTitleMatch: 5.0,
  exactPhraseSnippet: 4.0,
  intentBoost: 4.0,
  landingAnchorBoost: 2.5,  // Prefers sections with direct anchors
  deltaSmoothing: 1.0       // BM25Plus smoothing to avoid IDF zeroing on small corpora
};

export const MIN_CONFIDENCE_THRESHOLD = 2.8;

/**
 * Client-Side BM25Plus Lexical & Intent Search Engine
 * Ultra-fast (<1ms) CPU ranking with stemming, synonym expansion, and confidence thresholding.
 */
export class ClientBM25Engine {
  private k1: number = 1.5;
  private b: number = 0.75;
  private sections: SectionNode[] = [];
  private docTokens: string[][] = [];
  private docLengths: number[] = [];
  private avgDocLength: number = 0;
  private docFreqs: Map<string, number> = new Map();

  public index(sections: SectionNode[]) {
    this.sections = sections;
    this.docTokens = [];
    this.docLengths = [];
    this.docFreqs.clear();

    let totalLen = 0;

    for (const sec of sections) {
      const fullText = `${sec.title} ${sec.pageTitle} ${sec.snippet} ${sec.metadata?.price || ''} ${sec.metadata?.timings || ''}`;
      // Index tokens using normalized stemming
      const tokens = normalizeAndTokenize(fullText, true);
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

  public tokenize(text: string): string[] {
    return normalizeAndTokenize(text, true);
  }

  public search(query: string, currentUrl: string, topK: number = 6): SearchResultItem[] {
    const rawClean = query.toLowerCase().trim();
    const baseTokens = normalizeAndTokenize(query, true);
    if (!baseTokens.length || !this.sections.length) return [];

    // Query expansion via curated vocabulary
    const { expandedTokens, whyMatchedMap } = expandQuery(query, baseTokens);

    const scores: {
      index: number;
      score: number;
      matchType: 'exact_keyword' | 'semantic' | 'title';
      whyMatched: string;
    }[] = [];

    const N = this.sections.length;

    for (let i = 0; i < N; i++) {
      const doc = this.sections[i];
      const tokens = this.docTokens[i];
      const docLen = this.docLengths[i];
      let bm25Score = 0;
      const matchedTerms: string[] = [];

      // Token frequency count
      const termFreqs = new Map<string, number>();
      for (const t of tokens) {
        termFreqs.set(t, (termFreqs.get(t) || 0) + 1);
      }

      for (const qTerm of expandedTokens) {
        const tf = termFreqs.get(qTerm) || 0;
        const df = this.docFreqs.get(qTerm) || 0;
        if (df === 0 || tf === 0) continue;

        matchedTerms.push(qTerm);

        // BM25Plus formulation: idf * ( (tf * (k1 + 1)) / (tf + k1*(1 - b + b*(docLen/avgDocLen))) + delta )
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const denominator = tf + this.k1 * (1 - this.b + this.b * (docLen / this.avgDocLength));
        const termScore = idf * ((tf * (this.k1 + 1)) / denominator + RANKING_WEIGHTS.deltaSmoothing);
        
        // Slightly discount terms that were expanded from synonyms vs original tokens
        const weight = baseTokens.includes(qTerm) ? 1.0 : 0.75;
        bm25Score += termScore * weight;
      }

      // If no query terms matched at all, skip
      if (matchedTerms.length === 0) continue;

      // Title & Exact Phrase Boost
      let boost = 0;
      let titleMatched = false;
      const titleLower = doc.title.toLowerCase();
      const snippetLower = doc.snippet.toLowerCase();

      if (titleLower.includes(rawClean)) {
        boost += RANKING_WEIGHTS.exactPhraseTitle;
        titleMatched = true;
      } else if (baseTokens.some(t => titleLower.includes(t))) {
        boost += RANKING_WEIGHTS.partialTitleMatch;
      }

      if (snippetLower.includes(rawClean)) {
        boost += RANKING_WEIGHTS.exactPhraseSnippet;
      }

      // Landing Anchor Confidence: Prefer sections with direct anchors
      const landingConf = doc.landingConfidence !== undefined ? doc.landingConfidence : (doc.anchorId ? 1.0 : 0.5);
      boost += landingConf * RANKING_WEIGHTS.landingAnchorBoost;

      // Intent keyword boosts (pricing, timings, returns, specs)
      if (/price|cost|fee|charge|tariff|₹|\$|timing|hour|schedule|doctor|return|refund|spec/i.test(rawClean)) {
        if (doc.metadata?.price || doc.metadata?.timings || /spec|policy|return|pricing|doctor/i.test(doc.url)) {
          boost += RANKING_WEIGHTS.intentBoost;
        }
      }

      const totalScore = (bm25Score * RANKING_WEIGHTS.bm25) + boost;

      // Calibrated Minimum Confidence Threshold
      if (totalScore >= MIN_CONFIDENCE_THRESHOLD) {
        // Build truthful "why this matched" description
        let whyMatched = '';
        if (titleMatched) {
          whyMatched = `Exact phrase in title: "${doc.title}"`;
        } else {
          const expansionUsed = matchedTerms.find(t => whyMatchedMap.has(t));
          if (expansionUsed) {
            whyMatched = `Matched ${whyMatchedMap.get(expansionUsed)}`;
          } else {
            whyMatched = `Matched terms: ${matchedTerms.slice(0, 3).join(', ')}`;
          }
        }

        scores.push({
          index: i,
          score: totalScore,
          matchType: boost >= 10 ? 'title' : totalScore >= 5 ? 'exact_keyword' : 'semantic',
          whyMatched
        });
      }
    }

    scores.sort((a, b) => b.score - a.score);

    return scores.slice(0, topK).map(s => {
      const sec = this.sections[s.index];
      let targetUrl = sec.url;
      if (sec.anchorId && !targetUrl.includes('#')) {
        targetUrl = `${targetUrl}#${sec.anchorId}`;
      }

      const isCurrentPage = currentUrl.split('#')[0].replace(/\/$/, '') === sec.url.split('#')[0].replace(/\/$/, '');

      return {
        ...sec,
        targetUrl,
        score: Math.round(s.score * 100) / 100,
        matchType: s.matchType,
        whyMatched: s.whyMatched,
        isCurrentPage
      };
    });
  }
}
