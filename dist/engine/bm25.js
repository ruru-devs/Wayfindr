/**
 * Client-Side BM25 Lexical & Intent Search Engine
 * Ultra-fast (<5ms) ranking for extension tabs with zero external API calls.
 */
export class ClientBM25Engine {
    constructor() {
        this.k1 = 1.5;
        this.b = 0.75;
        this.sections = [];
        this.docTokens = [];
        this.docLengths = [];
        this.avgDocLength = 0;
        this.docFreqs = new Map();
    }
    index(sections) {
        this.sections = sections;
        this.docTokens = [];
        this.docLengths = [];
        this.docFreqs.clear();
        let totalLen = 0;
        for (const sec of sections) {
            const fullText = `${sec.title} ${sec.pageTitle} ${sec.snippet} ${sec.metadata?.price || ''} ${sec.metadata?.timings || ''}`;
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
        return (text.toLowerCase().match(/\b[a-z0-9_-]{2,}\b/g) || []);
    }
    search(query, currentUrl, topK = 6) {
        const qTokens = this.tokenize(query);
        if (!qTokens.length || !this.sections.length)
            return [];
        const scores = [];
        const N = this.sections.length;
        const qClean = query.toLowerCase().trim();
        for (let i = 0; i < N; i++) {
            const doc = this.sections[i];
            const tokens = this.docTokens[i];
            const docLen = this.docLengths[i];
            let bm25Score = 0;
            // Token frequency count
            const termFreqs = new Map();
            for (const t of tokens) {
                termFreqs.set(t, (termFreqs.get(t) || 0) + 1);
            }
            for (const qTerm of qTokens) {
                const tf = termFreqs.get(qTerm) || 0;
                const df = this.docFreqs.get(qTerm) || 0;
                if (df === 0 || tf === 0)
                    continue;
                const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
                const numerator = tf * (this.k1 + 1);
                const denominator = tf + this.k1 * (1 - this.b + this.b * (docLen / this.avgDocLength));
                bm25Score += idf * (numerator / denominator);
            }
            // Title & Exact Phrase Boost
            let boost = 0;
            const titleLower = doc.title.toLowerCase();
            if (titleLower.includes(qClean)) {
                boost += 12.0; // exact phrase in title
            }
            else if (qTokens.some(t => titleLower.includes(t))) {
                boost += 4.5;
            }
            // Intent keyword boosts (pricing, timings, returns, specs)
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
                    matchType: boost >= 10 ? 'title' : totalScore >= 4 ? 'exact_keyword' : 'semantic'
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
                isCurrentPage
            };
        });
    }
}
