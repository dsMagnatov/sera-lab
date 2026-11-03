import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineConfig } from 'vite';
import { defaults } from './src/settings.js';

const endpoint = '/__studio/settings';

function matchesSettings(value, template) {
  if (typeof template === 'number') return Number.isFinite(value);
  if (typeof template === 'string') return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  if (typeof template === 'boolean') return typeof value === 'boolean';
  return value && typeof value === 'object'
    && Object.keys(value).length === Object.keys(template).length
    && Object.entries(template).every(([key, field]) => matchesSettings(value[key], field));
}

export default defineConfig({
  server: { watch: { ignored: ['**/public/bloodstream-settings.json', '**/.bloodstream-settings.tmp'] } },
  plugins: [{
    name: 'studio-settings',
    configureServer(server) {
      const settingsFile = join(server.config.publicDir, 'bloodstream-settings.json');
      const temporaryFile = join(server.config.root, '.bloodstream-settings.tmp');
      let pendingWrite = Promise.resolve();
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== endpoint) return next();
        const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
        const local = loopback && /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(req.headers.host ?? '');
        if (req.method !== 'POST' || !local || req.headers.origin !== `http://${req.headers.host}`
          || req.headers['content-type'] !== 'application/json') {
          res.writeHead(403).end();
          return;
        }

        try {
          let body = '';
          for await (const chunk of req) {
            body += chunk;
            if (body.length > 16_384) {
              res.writeHead(413).end();
              return;
            }
          }
          const { settings, migrate } = JSON.parse(body);
          if (!matchesSettings(settings, defaults)) {
            res.writeHead(400).end();
            return;
          }
          const write = pendingWrite.then(async () => {
            if (migrate === true && JSON.parse(await readFile(settingsFile, 'utf8')) !== null) return false;
            await writeFile(temporaryFile, `${JSON.stringify(settings, null, 2)}\n`);
            await rename(temporaryFile, settingsFile);
            return true;
          });
          pendingWrite = write.catch(() => {});
          res.writeHead(await write ? 204 : 409).end();
        } catch (error) {
          if (error instanceof SyntaxError || error instanceof TypeError) {
            res.writeHead(400).end();
          } else {
            server.config.logger.error(`Could not save studio settings: ${error.message}`);
            res.writeHead(500).end();
          }
        }
      });
    },
  }],
});
