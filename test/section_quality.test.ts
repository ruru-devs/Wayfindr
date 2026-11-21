import { describe, it } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import { extractSectionsFromDoc, generateDomPath, generateSlug, generateTextFragment } from '../src/engine/sectionizer';

describe('Phase 1C: Section Quality, Hierarchy Deduplication & Locators', () => {
  it('deduplicates nested structural wrappers and preserves specific child sections', () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>Nested Test</title></head>
      <body>
        <main id="main-wrapper">
          <section id="section-wrapper">
            <article id="child-cardiology">
              <h2>Cardiology Services</h2>
              <p>Comprehensive heart failure and angioplasty treatment by senior cardiologists.</p>
            </article>
            <article id="child-neurology">
              <h2>Neurology Services</h2>
              <p>Stroke rehabilitation and epilepsy management by certified neuro specialists.</p>
            </article>
          </section>
        </main>
      </body>
      </html>
    `;

    const dom = new JSDOM(html);
    const sections = extractSectionsFromDoc(dom.window.document, 'https://test.com/nested', 'Nested Test');

    const ids = sections.map(s => s.anchorId);

    // Specific children must be indexed
    assert.ok(ids.includes('child-cardiology'));
    assert.ok(ids.includes('child-neurology'));

    // Structural wrapper 'main-wrapper' and 'section-wrapper' must NOT produce duplicate sections
    assert.ok(!ids.includes('main-wrapper'));
    assert.ok(!ids.includes('section-wrapper'));
    assert.strictEqual(sections.length, 2);
  });

  it('preserves parent when parent contains meaningful standalone text', () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>Parent With Text</title></head>
      <body>
        <section id="parent-services">
          <h2>Department Overview & Clinical Standards</h2>
          <p>We adhere to strict international clinical protocols and patient safety benchmarks. Our hospital operates continuous 24/7 care across all medical and surgical wings.</p>
          <article id="child-icu">
            <h3>Intensive Care Unit</h3>
            <p>Advanced life support and post-operative monitoring beds.</p>
          </article>
        </section>
      </body>
      </html>
    `;

    const dom = new JSDOM(html);
    const sections = extractSectionsFromDoc(dom.window.document, 'https://test.com/services', 'Services');

    const ids = sections.map(s => s.anchorId);
    assert.ok(ids.includes('parent-services'));
    assert.ok(ids.includes('child-icu'));
    assert.strictEqual(sections.length, 2);
  });

  it('generates fallback locators and text fragments when section has no native id', () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>Unanchored Section</title></head>
      <body>
        <main>
          <section>
            <h2>Diagnostic Imaging Protocols</h2>
            <p>Our imaging center is equipped with low-radiation digital radiography and high-speed ultrasound.</p>
          </section>
        </main>
      </body>
      </html>
    `;

    const dom = new JSDOM(html);
    const sections = extractSectionsFromDoc(dom.window.document, 'https://test.com/imaging', 'Imaging');

    assert.strictEqual(sections.length, 1);
    const sec = sections[0];

    // Generated slug anchor
    assert.strictEqual(sec.anchorId, 'diagnostic-imaging-protocols');
    assert.strictEqual(sec.hasUsableAnchor, true);
    assert.strictEqual(sec.landingConfidence, 0.85);

    // Generated DOM path and text fragment
    assert.ok(sec.locator && sec.locator.includes('section'));
    assert.ok(sec.textFragment && sec.textFragment.startsWith('#:~:text='));
    assert.ok(sec.textFragment.includes('Diagnostic'));
  });

  it('correctly computes DOM path selector and text fragment utilities', () => {
    const dom = new JSDOM('<div><main><article><p>First paragraph</p></article></main></div>');
    const article = dom.window.document.querySelector('article')!;

    const path = generateDomPath(article);
    assert.strictEqual(path, 'div > main > article');

    const slug = generateSlug('3.0 Tesla MRI Scan Charges & Protocols!');
    assert.strictEqual(slug, '30-tesla-mri-scan-charges-protocols');

    const frag = generateTextFragment('Try any PulseTech product risk-free for thirty days.');
    assert.ok(frag.startsWith('#:~:text='));
    assert.ok(frag.includes('PulseTech'));
  });
});
