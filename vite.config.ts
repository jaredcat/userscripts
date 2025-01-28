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

export default defineConfig(({ mode, command }) => {
  const scriptName = mode || getScriptDirs()[0];
  const isDev = command === 'serve' || process.env.WATCH === 'true';

  return {
    build: {
      emptyOutDir: false,
      watch: isDev ? {} : null,
    },
    server: {
      port: 3000,
      hmr: true,
      open: false,
    },
    plugins: [
      monkey({
        entry: `src/scripts/${scriptName}/main.ts`,
        build: {
          fileName: `${scriptName}.user.js`,
          externalGlobals: isDev ? {} : undefined,
        },
        server: {
          prefix: scriptName,
        },
        userscript: {
          namespace: `jaredcat/${scriptName}`,
          author: 'jaredcat',
          updateURL: isDev
            ? `http://localhost:3000/${scriptName}.user.js`
            : `https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/${scriptName}.user.js`,
          downloadURL: isDev
            ? `http://localhost:3000/${scriptName}.user.js`
            : `https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/${scriptName}.user.js`,
          license: 'AGPL-3.0-or-later',
          ...require(`./src/scripts/${scriptName}/meta.ts`).default,
        },
      }),
    ],
  };
});
