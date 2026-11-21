const path = require('path');
const { execSync } = require('child_process');

console.log('[Wayfindr] Bundling extension scripts with esbuild...');

const esbuildPath = path.resolve(__dirname, '../Kursor/widget/node_modules/@esbuild/linux-x64/bin/esbuild');

try {
  // Bundle background service worker as a self-contained IIFE/bundle
  execSync(`"${esbuildPath}" src/background/service_worker.ts --bundle --outfile=dist/background/service_worker.js --target=es2020 --format=iife`, { stdio: 'inherit' });

  // Bundle content script as a self-contained IIFE/bundle
  execSync(`"${esbuildPath}" src/content/content_script.ts --bundle --outfile=dist/content/content_script.js --target=es2020 --format=iife`, { stdio: 'inherit' });

  console.log('✓ Successfully bundled standalone background.js and content.js without unresolvable ES module imports!');
} catch (err) {
  console.error('Build failed:', err);
  process.exit(1);
}
