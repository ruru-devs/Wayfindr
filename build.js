const path = require('path');
const { execSync } = require('child_process');

console.log('[Wayfindr] Compiling extension TypeScript...');

const tscPath = path.resolve(__dirname, '../Kursor/widget/node_modules/typescript/bin/tsc');

try {
  execSync(`node "${tscPath}" --project tsconfig.json`, { stdio: 'inherit' });
  console.log('✓ Successfully compiled extension scripts to dist/');
} catch (err) {
  console.error('Build failed:', err);
  process.exit(1);
}
