'use strict';
// On a Mac build, ad-hoc sign the app so it launches on Apple Silicon
// (no Apple Developer account needed; users still right-click > Open the first time).
const { execSync } = require('child_process');
const path = require('path');
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin' || process.platform !== 'darwin') return;
  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  try { execSync(`codesign --force --deep --sign - "${app}"`, { stdio: 'inherit' }); } catch (e) { console.warn('ad-hoc codesign failed:', e.message); }
};
