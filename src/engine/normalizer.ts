/**
 * High-Speed Dependency-Free Lexical Normalizer & Stemmer
 * Handles stopword removal, suffix-stripping light stemming, and synonym expansion.
 */

import synonymsData from './synonyms.json';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
  'can', 'could', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'his', 'she',
  'her', 'it', 'its', 'they', 'their', 'this', 'that', 'these', 'those', 'what',
  'which', 'who', 'whom', 'where', 'when', 'why', 'how', 'there', 'here',
  // Common Hinglish stopwords
  'ka', 'ki', 'ke', 'hai', 'ho', 'ko', 'se', 'me', 'par', 'kya', 'kare', 'karega',
  'raha', 'rahe', 'hoga', 'hogi', 'tha', 'thi', 'the'
]);

/**
 * Lightweight deterministic suffix stripper (Porter-like without external dependencies)
 */
export function stemToken(token: string): string {
  let word = token.toLowerCase();
  if (word.length <= 3) return word;

  // Step 1: Plural suffixes
  if (word.endsWith('ies') && word.length > 4) {
    word = word.slice(0, -3) + 'y';
  } else if (word.endsWith('es') && word.length > 4) {
    // If preceded by s, x, z, ch, sh, strip 'es' (e.g. boxes -> box, watches -> watch)
    // Otherwise strip 's' preserving base 'e' (e.g. headphones -> headphone, charges -> charge)
    if (/([sxz]|ch|sh)es$/.test(word)) {
      word = word.slice(0, -2);
    } else {
      word = word.slice(0, -1);
    }
  } else if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) {
    word = word.slice(0, -1);
  }

  // Step 2: Derivational & Inflectional suffixes
  if (word.endsWith('ing') && word.length > 5) {
    const base = word.slice(0, -3);
    if (base.length >= 3 && base[base.length - 1] === base[base.length - 2]) {
      return base.slice(0, -1);
    }
    return base;
  }
  if (word.endsWith('ed') && word.length > 4) {
    const base = word.slice(0, -2);
    if (base.length >= 3 && base[base.length - 1] === base[base.length - 2]) {
      return base.slice(0, -1);
    }
    return base;
  }
  if (word.endsWith('ment') && word.length > 5) {
    return word.slice(0, -4);
  }
  if (word.endsWith('tion') && word.length > 5) {
    return word.slice(0, -4);
  }

  return word;
}

/**
 * Tokenizes text, optionally removes stopwords, and applies light stemming.
 */
export function normalizeAndTokenize(text: string, removeStopwords: boolean = true): string[] {
  if (!text) return [];
  const rawTokens = text.toLowerCase().match(/\b[a-z0-9_-]{2,}\b/g) || [];
  const result: string[] = [];

  for (const t of rawTokens) {
    if (removeStopwords && STOPWORDS.has(t)) {
      continue;
    }
    const stemmed = stemToken(t);
    if (stemmed.length >= 2) {
      result.push(stemmed);
    }
  }

  return result;
}

/**
 * Query Expansion: Expands query tokens using the curated synonyms vocabulary.
 * Applied strictly at query time to preserve compact index size.
 */
export function expandQuery(
  rawQuery: string,
  baseTokens: string[]
): { expandedTokens: string[]; whyMatchedMap: Map<string, string> } {
  const qLower = rawQuery.toLowerCase();
  const tokenSet = new Set(baseTokens);
  const whyMatchedMap = new Map<string, string>(); // token -> reason
  const groups = synonymsData.synonym_groups as string[][];

  for (const group of groups) {
    // Check if any synonym in the group matches the query string or tokens
    let groupMatched = false;
    let matchedSynonym = '';

    for (const syn of group) {
      const synLower = syn.toLowerCase();
      if (qLower.includes(synLower) || tokenSet.has(stemToken(synLower))) {
        groupMatched = true;
        matchedSynonym = syn;
        break;
      }
    }

    if (groupMatched) {
      // Add other synonyms from this group
      for (const syn of group) {
        const tokens = normalizeAndTokenize(syn, false);
        for (const t of tokens) {
          if (!tokenSet.has(t)) {
            tokenSet.add(t);
            whyMatchedMap.set(t, `intent alias '${matchedSynonym}' → '${syn}'`);
          }
        }
      }
    }
  }

  return {
    expandedTokens: Array.from(tokenSet),
    whyMatchedMap
  };
}
