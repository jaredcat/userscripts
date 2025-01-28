import fs from 'fs';
import { resolve } from 'path';
import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

// Helper to get all script directories
const getScriptDirs = () => {
  const scriptsPath = resolve(__dirname, 'src/scripts');
  return fs
    .readdirSync(scriptsPath, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);
};

export default defineConfig(({ mode }) => {
  const scriptName = mode || getScriptDirs()[0];

  return {
    build: {
      emptyOutDir: false,
    },
    plugins: [
      monkey({
        entry: `src/scripts/${scriptName}/main.ts`,
        build: {
          fileName: `${scriptName}.user.js`,
        },
        userscript: {
          namespace: `jaredcat/${scriptName}`,
          author: 'jaredcat',
          updateURL: `https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/${scriptName}.user.js`,
          downloadURL: `https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/${scriptName}.user.js`,
          license: 'AGPL-3.0-or-later',
          ...require(`./src/scripts/${scriptName}/meta.ts`).default,
        },
      }),
    ],
  };
});
