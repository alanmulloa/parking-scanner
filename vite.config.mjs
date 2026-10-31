import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const sources = [
  'assets/js/core.js',
  'assets/js/records-shared.js',
  'assets/js/auth-navigation.js',
  'assets/js/admin/dashboard.js',
  'assets/js/admin/management.js',
  'assets/js/admin/advanced.js',
  'assets/js/control/control.js',
  'assets/js/admin/requests.js',
  'assets/js/admin/incidents.js',
  'assets/js/admin/audit.js',
  'assets/js/owner/owner.js',
];

function parkingFrontendBundle() {
  return {
    name: 'parking-frontend-bundle',

    buildStart() {
      for (const file of sources) {
        this.addWatchFile(path.resolve(file));
      }
    },

    generateBundle(_options, bundle) {
      const code =
        sources
          .map(file => fs.readFileSync(path.resolve(file), 'utf8').replace(/\s+$/, ''))
          .join('\n') + '\n';

      this.emitFile({
        type: 'asset',
        fileName: 'assets/js/app.bundle.js',
        source: code,
      });

      for (const [fileName, item] of Object.entries(bundle)) {
        if (item.type === 'chunk' && fileName.endsWith('.vite-empty.js')) {
          delete bundle[fileName];
        }
      }
    },
  };
}

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    write: true,
    rollupOptions: {
      input: 'tools/frontend/vite-empty-entry.js',
      output: {
        entryFileNames: 'assets/js/.vite-empty.js',
      },
    },
  },
  plugins: [parkingFrontendBundle()],
});
