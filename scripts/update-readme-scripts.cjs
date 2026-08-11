// Regenerates the "## Scripts" list in README.md from each src/<script>/meta.ts (name + description).
// Invoked at the end of `pnpm build` via scripts/build-all.cjs.
const fs = require('node:fs');
const path = require('node:path');

const MARKER_START = '<!-- scripts-list:start -->';
const MARKER_END = '<!-- scripts-list:end -->';

// Same pattern as downloadURL in vite.config.ts (production).
const installUrl = (scriptDir) =>
  `https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/${scriptDir}.user.js`;

/**
 * @param {string} content
 * @returns {{ name: string | null; description: string }}
 */
function parseMeta(content) {
  const nameMatch = new RegExp(/\bname:\s*['"]([^'"]+)['"]/).exec(content);
  // `\s*` already matches newlines, so this covers both `description: '…'` and
  // a quoted string on the following line.
  const descriptionMatch = new RegExp(/\bdescription:\s*['"]([^'"]+)['"]/).exec(
    content,
  );
  return {
    name: nameMatch ? nameMatch[1] : null,
    description: descriptionMatch?.[1] || 'Userscript',
  };
}

function main() {
  const root = path.resolve(__dirname, '..');
  const readmePath = path.join(root, 'README.md');
  const scriptsDir = path.join(root, 'src');

  let readme = fs.readFileSync(readmePath, 'utf8');
  const startIdx = readme.indexOf(MARKER_START);
  const endIdx = readme.indexOf(MARKER_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    console.error(
      `README.md must contain ${MARKER_START} and ${MARKER_END} (in order).`,
    );
    process.exit(1);
  }

  const dirs = fs
    .readdirSync(scriptsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));

  const lines = [];
  for (const dir of dirs) {
    const metaPath = path.join(scriptsDir, dir, 'meta.ts');
    if (!fs.existsSync(metaPath)) continue;
    const metaSource = fs.readFileSync(metaPath, 'utf8');
    if (/export const isListedInReadme = false\b/.test(metaSource)) continue;
    const meta = parseMeta(metaSource);
    const name = meta.name ?? dir;
    const readmeLink = `src/${dir}/README.md`;
    lines.push(
      `- **[${name}](${readmeLink})** ([Install](${installUrl(dir)})) — ${meta.description}`,
    );
  }

  const before = readme.slice(0, startIdx + MARKER_START.length);
  const after = readme.slice(endIdx);
  const newReadme = `${before}\n${lines.join('\n')}\n${after}`;

  fs.writeFileSync(readmePath, newReadme, 'utf8');
  console.log('Updated README.md scripts list from src/*/meta.ts.');
}

main();
