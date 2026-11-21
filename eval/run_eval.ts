/**
 * Wayfindr Quantitative Search Evaluation Runner
 * Runnable via: npm run eval
 */

import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { JSDOM } from 'jsdom';
import { extractSectionsFromDoc } from '../src/engine/sectionizer';
import { ClientBM25Engine } from '../src/engine/bm25';
import { SectionNode, SearchResultItem } from '../src/engine/types';

interface EvalQuery {
  id: string;
  site_id: string;
  query: string;
  expected_url: string;
  expected_anchor: string;
  category: string;
  is_negative: boolean;
}

const SITES_CONFIG: Record<string, { fixtureDir: string; baseUrl: string; docTitlePrefix: string }> = {
  'apexcare-clinic.org': {
    fixtureDir: path.resolve(__dirname, 'fixtures/hospital'),
    baseUrl: 'https://apexcare-clinic.org',
    docTitlePrefix: 'ApexCare'
  },
  'pulsetech-audio.com': {
    fixtureDir: path.resolve(__dirname, 'fixtures/ecommerce'),
    baseUrl: 'https://pulsetech-audio.com',
    docTitlePrefix: 'PulseTech'
  },
  'warpapi-docs.io': {
    fixtureDir: path.resolve(__dirname, 'fixtures/docs'),
    baseUrl: 'https://warpapi-docs.io',
    docTitlePrefix: 'WarpAPI'
  }
};

function loadAndSectionizeSite(siteId: string): SectionNode[] {
  const config = SITES_CONFIG[siteId];
  if (!config) throw new Error(`Unknown site: ${siteId}`);

  const files = fs.readdirSync(config.fixtureDir).filter(f => f.endsWith('.html'));
  const allSections: SectionNode[] = [];

  for (const file of files) {
    const filePath = path.join(config.fixtureDir, file);
    const html = fs.readFileSync(filePath, 'utf-8');
    const pageUrl = `${config.baseUrl}/${file}`;

    const dom = new JSDOM(html);
    const docTitle = dom.window.document.title || `${config.docTitlePrefix} › ${file}`;
    const sections = extractSectionsFromDoc(dom.window.document, pageUrl, docTitle);
    allSections.push(...sections);
  }

  return allSections;
}

async function runEvaluation() {
  console.log('======================================================================');
  console.log('WAYFINDR SEARCH QUALITY & LANDING HARNESS');
  console.log('======================================================================\n');

  // 1. Load queries
  const queriesPath = path.resolve(__dirname, 'queries.json');
  const queries: EvalQuery[] = JSON.parse(fs.readFileSync(queriesPath, 'utf-8'));

  // 2. Index fixtures per site
  const siteEngines: Record<string, { engine: ClientBM25Engine; sections: SectionNode[] }> = {};

  for (const siteId of Object.keys(SITES_CONFIG)) {
    const sections = loadAndSectionizeSite(siteId);
    const engine = new ClientBM25Engine();
    engine.index(sections);
    siteEngines[siteId] = { engine, sections };
    console.log(`[Eval] Indexed site: ${siteId} (${sections.length} sections)`);
  }

  console.log(`\n[Eval] Running evaluation across ${queries.length} ground-truth test queries...\n`);

  // 3. Metrics accumulators
  let totalPositive = 0;
  let totalNegative = 0;

  let top1ExactMatches = 0;
  let top1PageMatches = 0;
  let recall5ExactMatches = 0;
  let recall5PageMatches = 0;
  let landingSuccessCount = 0;

  let sumReciprocalRankExact = 0;
  let sumReciprocalRankPage = 0;

  let zeroResultCount = 0;
  let falsePositiveCount = 0;

  const latenciesMs: number[] = [];

  // Breakdowns
  const siteStats: Record<string, {
    posCount: number;
    negCount: number;
    top1Exact: number;
    recall5Exact: number;
    landingSuccess: number;
    sumRRExact: number;
    negFP: number;
  }> = {};

  const categoryStats: Record<string, {
    count: number;
    top1Exact: number;
    recall5Exact: number;
    landingSuccess: number;
    sumRRExact: number;
  }> = {};

  for (const q of queries) {
    const siteObj = siteEngines[q.site_id];
    if (!siteObj) continue;

    if (!siteStats[q.site_id]) {
      siteStats[q.site_id] = { posCount: 0, negCount: 0, top1Exact: 0, recall5Exact: 0, landingSuccess: 0, sumRRExact: 0, negFP: 0 };
    }
    if (!categoryStats[q.category]) {
      categoryStats[q.category] = { count: 0, top1Exact: 0, recall5Exact: 0, landingSuccess: 0, sumRRExact: 0 };
    }

    const tStart = performance.now();
    const results: SearchResultItem[] = siteObj.engine.search(q.query, `${SITES_CONFIG[q.site_id].baseUrl}/index.html`, 5);
    const duration = performance.now() - tStart;
    latenciesMs.push(duration);

    if (q.is_negative) {
      totalNegative++;
      siteStats[q.site_id].negCount++;
      // A negative query is a false positive if it returns results above minimum threshold
      if (results.length > 0) {
        falsePositiveCount++;
        siteStats[q.site_id].negFP++;
      }
    } else {
      totalPositive++;
      siteStats[q.site_id].posCount++;
      categoryStats[q.category].count++;

      if (results.length === 0) {
        zeroResultCount++;
        continue;
      }

      // Check Top-1 Result
      const top1 = results[0];
      const isTop1Page = top1.targetUrl.split('#')[0] === q.expected_url;
      const isTop1Exact = isTop1Page && (top1.anchorId === q.expected_anchor || top1.id.includes(q.expected_anchor));

      if (isTop1Exact) {
        top1ExactMatches++;
        siteStats[q.site_id].top1Exact++;
        categoryStats[q.category].top1Exact++;

        // Landing success: Top-1 has usable anchor or locator
        if (top1.anchorId) {
          landingSuccessCount++;
          siteStats[q.site_id].landingSuccess++;
          categoryStats[q.category].landingSuccess++;
        }
      }

      if (isTop1Page) {
        top1PageMatches++;
      }

      // Check Recall@5 & MRR
      let foundExactRank = 0;
      let foundPageRank = 0;

      for (let i = 0; i < results.length; i++) {
        const item = results[i];
        const pageMatch = item.targetUrl.split('#')[0] === q.expected_url;
        const exactMatch = pageMatch && (item.anchorId === q.expected_anchor || item.id.includes(q.expected_anchor));

        if (exactMatch && foundExactRank === 0) {
          foundExactRank = i + 1;
        }
        if (pageMatch && foundPageRank === 0) {
          foundPageRank = i + 1;
        }
      }

      if (foundExactRank > 0) {
        recall5ExactMatches++;
        siteStats[q.site_id].recall5Exact++;
        categoryStats[q.category].recall5Exact++;
        sumReciprocalRankExact += 1.0 / foundExactRank;
        siteStats[q.site_id].sumRRExact += 1.0 / foundExactRank;
        categoryStats[q.category].sumRRExact += 1.0 / foundExactRank;
      }

      if (foundPageRank > 0) {
        recall5PageMatches++;
        sumReciprocalRankPage += 1.0 / foundPageRank;
      }
    }
  }

  // Latency calculation
  latenciesMs.sort((a, b) => a - b);
  const p50 = latenciesMs[Math.floor(latenciesMs.length * 0.50)] || 0;
  const p95 = latenciesMs[Math.floor(latenciesMs.length * 0.95)] || 0;
  const p99 = latenciesMs[Math.floor(latenciesMs.length * 0.99)] || 0;

  // Rate calculations
  const top1ExactPct = (top1ExactMatches / totalPositive) * 100;
  const top1PagePct = (top1PageMatches / totalPositive) * 100;
  const recall5ExactPct = (recall5ExactMatches / totalPositive) * 100;
  const recall5PagePct = (recall5PageMatches / totalPositive) * 100;
  const mrrExact = sumReciprocalRankExact / totalPositive;
  const mrrPage = sumReciprocalRankPage / totalPositive;
  const landingSuccessPct = (landingSuccessCount / (top1ExactMatches || 1)) * 100;
  const zeroResultPct = (zeroResultCount / totalPositive) * 100;
  const falsePositivePct = (falsePositiveCount / totalNegative) * 100;

  const report = `======================================================================
WAYFINDR SEARCH EVALUATION REPORT
======================================================================
Total Queries Evaluated: ${queries.length} (Positive: ${totalPositive}, Negative: ${totalNegative})
----------------------------------------------------------------------
Top-1 Accuracy (Exact Section):   ${top1ExactPct.toFixed(2)}%
Top-1 Accuracy (Page-Level):      ${top1PagePct.toFixed(2)}%
Recall@5 (Exact Section):         ${recall5ExactPct.toFixed(2)}%
Recall@5 (Page-Level):            ${recall5PagePct.toFixed(2)}%
MRR (Mean Reciprocal Rank Exact): ${mrrExact.toFixed(4)}
MRR (Page-Level):                 ${mrrPage.toFixed(4)}
Landing Success (Top-1 Anchor):   ${landingSuccessPct.toFixed(2)}%
Zero-Result Rate (Positive Qs):   ${zeroResultPct.toFixed(2)}%
False-Positive Rate (Neg Qs):     ${falsePositivePct.toFixed(2)}%
----------------------------------------------------------------------
Latency p50:                      ${p50.toFixed(3)} ms
Latency p95:                      ${p95.toFixed(3)} ms
Latency p99:                      ${p99.toFixed(3)} ms
======================================================================

BREAKDOWN BY SITE:
Site ID                | Pos | Top-1 Exact | Recall@5  | MRR   | Land% | Neg FP% 
--------------------------------------------------------------------------------
${Object.entries(siteStats).map(([sid, s]) => {
  const t1 = ((s.top1Exact / s.posCount) * 100).toFixed(1);
  const r5 = ((s.recall5Exact / s.posCount) * 100).toFixed(1);
  const mrr = (s.sumRRExact / s.posCount).toFixed(3);
  const land = ((s.landingSuccess / (s.top1Exact || 1)) * 100).toFixed(1);
  const fp = ((s.negFP / s.negCount) * 100).toFixed(1);
  return `${sid.padEnd(22)} | ${String(s.posCount).padStart(3)} | ${t1.padStart(10)}% | ${r5.padStart(8)}% | ${mrr.padStart(5)} | ${land.padStart(5)}% | ${fp.padStart(6)}%`;
}).join('\n')}

BREAKDOWN BY QUERY CATEGORY:
Category        | Count | Top-1 Exact | Recall@5  | MRR   | Land%
----------------------------------------------------------------------
${Object.entries(categoryStats).map(([cat, c]) => {
  const t1 = ((c.top1Exact / c.count) * 100).toFixed(1);
  const r5 = ((c.recall5Exact / c.count) * 100).toFixed(1);
  const mrr = (c.sumRRExact / c.count).toFixed(3);
  const land = ((c.landingSuccess / (c.top1Exact || 1)) * 100).toFixed(1);
  return `${cat.padEnd(15)} | ${String(c.count).padStart(5)} | ${t1.padStart(10)}% | ${r5.padStart(8)}% | ${mrr.padStart(5)} | ${land.padStart(5)}%`;
}).join('\n')}
======================================================================
`;

  console.log(report);

  // If running for baseline recording, write to eval/BASELINE.md
  const isBaseline = process.argv.includes('--record-baseline');
  if (isBaseline || !fs.existsSync(path.resolve(__dirname, 'BASELINE.md'))) {
    const baselineMd = `# Wayfindr Search Retrieval Baseline Report

Recorded on: ${new Date().toISOString()}
Commit: Phase 1A Baseline (Pre-Search Quality Enhancements)

## 📊 Summary Metrics

| Metric | Baseline Score | Notes |
| :--- | :---: | :--- |
| **Top-1 Accuracy (Exact Section)** | **${top1ExactPct.toFixed(2)}%** | Requires exact anchor match |
| **Top-1 Accuracy (Page-Level)** | **${top1PagePct.toFixed(2)}%** | Resolves correct destination page |
| **Recall@5 (Exact Section)** | **${recall5ExactPct.toFixed(2)}%** | Target section appears in top 5 items |
| **Recall@5 (Page-Level)** | **${recall5PagePct.toFixed(2)}%** | Target page appears in top 5 items |
| **MRR (Exact Section)** | **${mrrExact.toFixed(4)}** | Mean reciprocal rank |
| **MRR (Page-Level)** | **${mrrPage.toFixed(4)}** | Page-level mean reciprocal rank |
| **Landing Success (Top-1 Anchor)**| **${landingSuccessPct.toFixed(2)}%** | Top-1 result has direct usable anchor |
| **Zero-Result Rate (Positive Qs)** | **${zeroResultPct.toFixed(2)}%** | Unmatched legitimate queries |
| **False-Positive Rate (Negative Qs)**| **${falsePositivePct.toFixed(2)}%** | Spurious matches on negative queries |
| **Latency p50 (Node.js CPU)** | **${p50.toFixed(3)} ms** | Median query latency |
| **Latency p95 (Node.js CPU)** | **${p95.toFixed(3)} ms** | 95th percentile query latency |

## 📁 Breakdown by Site

| Site Category | Pos Qs | Top-1 Exact | Recall@5 Exact | MRR Exact | Neg FP% |
| :--- | :---: | :---: | :---: | :---: | :---: |
${Object.entries(siteStats).map(([sid, s]) => {
  const t1 = ((s.top1Exact / s.posCount) * 100).toFixed(1);
  const r5 = ((s.recall5Exact / s.posCount) * 100).toFixed(1);
  const mrr = (s.sumRRExact / s.posCount).toFixed(3);
  const fp = ((s.negFP / s.negCount) * 100).toFixed(1);
  return `| \`${sid}\` | ${s.posCount} | ${t1}% | ${r5}% | ${mrr} | ${fp}% |`;
}).join('\n')}

## 🏷️ Breakdown by Query Category

| Category | Count | Top-1 Exact | Recall@5 Exact | MRR Exact | Landing% |
| :--- | :---: | :---: | :---: | :---: | :---: |
${Object.entries(categoryStats).map(([cat, c]) => {
  const t1 = ((c.top1Exact / c.count) * 100).toFixed(1);
  const r5 = ((c.recall5Exact / c.count) * 100).toFixed(1);
  const mrr = (c.sumRRExact / c.count).toFixed(3);
  const land = ((c.landingSuccess / (c.top1Exact || 1)) * 100).toFixed(1);
  return `| \`${cat}\` | ${c.count} | ${t1}% | ${r5}% | ${mrr} | ${land}% |`;
}).join('\n')}

\`\`\`
${report}
\`\`\`
`;
    fs.writeFileSync(path.resolve(__dirname, 'BASELINE.md'), baselineMd, 'utf-8');
    console.log('[Eval] Baseline numbers recorded to eval/BASELINE.md');
  }
}

runEvaluation().catch(err => {
  console.error('[Eval] Failed:', err);
  process.exit(1);
});
