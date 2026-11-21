import { describe, it } from 'node:test';
import assert from 'node:assert';
import { stemToken, normalizeAndTokenize, expandQuery } from '../src/engine/normalizer';
import { ClientBM25Engine } from '../src/engine/bm25';
import { SectionNode } from '../src/engine/types';

describe('Phase 2: Search Quality, Stemming & Query Expansion', () => {
  it('correctly stems English suffixes and inflections', () => {
    assert.strictEqual(stemToken('charges'), 'charge');
    assert.strictEqual(stemToken('treatments'), 'treat');
    assert.strictEqual(stemToken('policies'), 'policy');
    assert.strictEqual(stemToken('headphones'), 'headphone');
    assert.strictEqual(stemToken('earbuds'), 'earbud');
  });

  it('strips English and Hinglish stopwords from query tokens', () => {
    const tokens = normalizeAndTokenize('How can I get an MRI test done for my heart?');
    assert.ok(!tokens.includes('how'));
    assert.ok(!tokens.includes('can'));
    assert.ok(!tokens.includes('i'));
    assert.ok(!tokens.includes('an'));
    assert.ok(!tokens.includes('for'));
    assert.ok(!tokens.includes('my'));
    assert.ok(tokens.includes('mri'));
    assert.ok(tokens.includes('heart'));
  });

  it('expands domain vocabulary and Hinglish intent aliases at query time', () => {
    const q = 'dil ke doctor';
    const base = normalizeAndTokenize(q, true);
    const { expandedTokens, whyMatchedMap } = expandQuery(q, base);

    assert.ok(expandedTokens.includes('cardiolog') || expandedTokens.includes('cardiac') || expandedTokens.includes('heart'));
    assert.ok(whyMatchedMap.size > 0);
  });

  it('filters out irrelevant junk queries with calibrated confidence threshold', () => {
    const engine = new ClientBM25Engine();
    const sections: SectionNode[] = [
      {
        id: 'sec_cardio',
        url: 'https://hospital.org/cardiology',
        pageTitle: 'Cardiology',
        anchorId: 'heart-surgery',
        title: 'Cardiac Surgery and Angioplasty',
        snippet: 'Comprehensive coronary care by senior heart surgeons.',
        hasUsableAnchor: true
      },
      {
        id: 'sec_ortho',
        url: 'https://hospital.org/orthopedics',
        pageTitle: 'Orthopedics',
        anchorId: 'knee-replacement',
        title: 'Robotic Knee Replacement',
        snippet: 'Joint arthroplasty and sports injury rehabilitation.',
        hasUsableAnchor: true
      }
    ];

    engine.index(sections);

    // Negative out-of-domain queries must return empty array
    const junkResults1 = engine.search('fresh cheese pepperoni pizza', 'https://hospital.org', 5);
    assert.strictEqual(junkResults1.length, 0);

    const junkResults2 = engine.search('buy cheap airline tickets to paris', 'https://hospital.org', 5);
    assert.strictEqual(junkResults2.length, 0);

    // Valid positive query returns ranked match with whyMatched description
    const validResults = engine.search('heart doctor surgery', 'https://hospital.org', 5);
    assert.ok(validResults.length >= 1);
    assert.strictEqual(validResults[0].id, 'sec_cardio');
    assert.ok(validResults[0].whyMatched);
  });
});
