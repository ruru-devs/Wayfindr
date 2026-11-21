# Wayfindr Search Retrieval Baseline Report

Recorded on: 2026-11-21T20:17:15.548Z
Commit: Phase 1A Baseline (Pre-Search Quality Enhancements)

## 📊 Summary Metrics

| Metric | Baseline Score | Notes |
| :--- | :---: | :--- |
| **Top-1 Accuracy (Exact Section)** | **56.86%** | Requires exact anchor match |
| **Top-1 Accuracy (Page-Level)** | **96.08%** | Resolves correct destination page |
| **Recall@5 (Exact Section)** | **90.20%** | Target section appears in top 5 items |
| **Recall@5 (Page-Level)** | **97.06%** | Target page appears in top 5 items |
| **MRR (Exact Section)** | **0.7328** | Mean reciprocal rank |
| **MRR (Page-Level)** | **0.9641** | Page-level mean reciprocal rank |
| **Landing Success (Top-1 Anchor)**| **100.00%** | Top-1 result has direct usable anchor |
| **Zero-Result Rate (Positive Qs)** | **0.00%** | Unmatched legitimate queries |
| **False-Positive Rate (Negative Qs)**| **33.33%** | Spurious matches on negative queries |
| **Latency p50 (Node.js CPU)** | **0.290 ms** | Median query latency |
| **Latency p95 (Node.js CPU)** | **0.667 ms** | 95th percentile query latency |

## 📁 Breakdown by Site

| Site Category | Pos Qs | Top-1 Exact | Recall@5 Exact | MRR Exact | Neg FP% |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `apexcare-clinic.org` | 34 | 67.6% | 88.2% | 0.779 | 37.5% |
| `pulsetech-audio.com` | 34 | 55.9% | 88.2% | 0.721 | 37.5% |
| `warpapi-docs.io` | 34 | 47.1% | 94.1% | 0.699 | 25.0% |

## 🏷️ Breakdown by Query Category

| Category | Count | Top-1 Exact | Recall@5 Exact | MRR Exact | Landing% |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `exact` | 42 | 61.9% | 100.0% | 0.810 | 100.0% |
| `paraphrase` | 42 | 57.1% | 88.1% | 0.720 | 100.0% |
| `synonym` | 18 | 44.4% | 72.2% | 0.583 | 100.0% |
| `negative` | 0 | NaN% | NaN% | NaN | 0.0% |

```
======================================================================
WAYFINDR SEARCH EVALUATION REPORT
======================================================================
Total Queries Evaluated: 126 (Positive: 102, Negative: 24)
----------------------------------------------------------------------
Top-1 Accuracy (Exact Section):   56.86%
Top-1 Accuracy (Page-Level):      96.08%
Recall@5 (Exact Section):         90.20%
Recall@5 (Page-Level):            97.06%
MRR (Mean Reciprocal Rank Exact): 0.7328
MRR (Page-Level):                 0.9641
Landing Success (Top-1 Anchor):   100.00%
Zero-Result Rate (Positive Qs):   0.00%
False-Positive Rate (Neg Qs):     33.33%
----------------------------------------------------------------------
Latency p50:                      0.290 ms
Latency p95:                      0.667 ms
Latency p99:                      2.153 ms
======================================================================

BREAKDOWN BY SITE:
Site ID                | Pos | Top-1 Exact | Recall@5  | MRR   | Land% | Neg FP% 
--------------------------------------------------------------------------------
apexcare-clinic.org    |  34 |       67.6% |     88.2% | 0.779 | 100.0% |   37.5%
pulsetech-audio.com    |  34 |       55.9% |     88.2% | 0.721 | 100.0% |   37.5%
warpapi-docs.io        |  34 |       47.1% |     94.1% | 0.699 | 100.0% |   25.0%

BREAKDOWN BY QUERY CATEGORY:
Category        | Count | Top-1 Exact | Recall@5  | MRR   | Land%
----------------------------------------------------------------------
exact           |    42 |       61.9% |    100.0% | 0.810 | 100.0%
paraphrase      |    42 |       57.1% |     88.1% | 0.720 | 100.0%
synonym         |    18 |       44.4% |     72.2% | 0.583 | 100.0%
negative        |     0 |        NaN% |      NaN% |   NaN |   0.0%
======================================================================

```
