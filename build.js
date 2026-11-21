const esbuild = require('esbuild');

console.log('[Wayfindr] Bundling extension scripts with esbuild...');

const isWatch = process.argv.includes('--watch');

const buildOptions = [
  {
    entryPoints: ['src/background/service_worker.ts'],
    bundle: true,
    outfile: 'dist/background/service_worker.js',
    target: 'es2020',
    format: 'iife'
  },
  {
    entryPoints: ['src/content/content_script.ts'],
    bundle: true,
    outfile: 'dist/content/content_script.js',
    target: 'es2020',
    format: 'iife'
  }
];

async function run() {
  try {
    for (const opt of buildOptions) {
      if (isWatch) {
        const ctx = await esbuild.context(opt);
        await ctx.watch();
      } else {
        await esbuild.build(opt);
      }
    }
    console.log('✓ Successfully bundled standalone background.js and content.js with local esbuild!');
  } catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
  }
}

run();
