const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const sourceServerDir = path.join(projectRoot, 'server');
const distDir = path.join(projectRoot, 'dist');
const distServerDir = path.join(distDir, 'server');

function ensureFrontendBuildExists() {
  const indexHtmlPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    throw new Error('Frontend bundle is missing. Run `vite build` first.');
  }
}

function copyServerFiles() {
  const serverFiles = fs
    .readdirSync(sourceServerDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.cjs'))
    .map((entry) => entry.name);

  fs.rmSync(distServerDir, { recursive: true, force: true });
  fs.mkdirSync(distServerDir, { recursive: true });

  for (const fileName of serverFiles) {
    const sourcePath = path.join(sourceServerDir, fileName);
    const targetPath = path.join(distServerDir, fileName);
    fs.copyFileSync(sourcePath, targetPath);
  }

  return serverFiles;
}

function buildServerBundle() {
  ensureFrontendBuildExists();
  const copiedFiles = copyServerFiles();
  console.log(`Bundled backend files: ${copiedFiles.join(', ')}`);
  console.log(`Output directory: ${path.relative(projectRoot, distServerDir)}`);
}

buildServerBundle();
