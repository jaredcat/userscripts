const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const scriptsDir = path.resolve(__dirname, '../src/scripts');
const scripts = fs
  .readdirSync(scriptsDir, { withFileTypes: true })
  .filter((dirent) => dirent.isDirectory())
  .map((dirent) => dirent.name);

console.log({ scripts });
scripts.forEach((script) => {
  console.log(`Building ${script}...`);
  execSync(`vite build --mode ${script}`, { stdio: 'inherit' });
});
