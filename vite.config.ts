import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Simple dev-time proxy endpoint for AI analysis
function aiProxyPlugin() {
  return {
    name: 'ai-analyze-proxy',
    configureServer(server: any) {
      server.middlewares.use('/api/ai/analyze', async (req: any, res: any) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Method Not Allowed' }));
          return;
        }
        try {
          const chunks: Uint8Array[] = [];
          for await (const chunk of req) chunks.push(chunk);
          const bodyStr = Buffer.concat(chunks).toString('utf-8');
          const body = JSON.parse(bodyStr || '{}');
          const prompt = String(body.prompt || '');
          const apiKey = process.env.GEMINI_API_KEY;
          if (!apiKey) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Missing GEMINI_API_KEY' }));
            return;
          }

          // Call Google Generative Language API (Gemini)
          const model = process.env.GEMINI_MODEL || 'models/gemini-1.5-pro';
          const endpoint = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`;
          const genRes = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                { role: 'user', parts: [{ text: prompt }] }
              ],
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 1024
              }
            })
          });

          if (!genRes.ok) {
            const txt = await genRes.text();
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'LLM bad response', detail: txt }));
            return;
          }

          const data: any = await genRes.json();
          const text: string = data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join(' ').trim() || '';

          const extractJson = (s: string) => {
            try { return JSON.parse(s); } catch {}
            const start = s.indexOf('{');
            const end = s.lastIndexOf('}');
            if (start >= 0 && end > start) {
              const sub = s.slice(start, end + 1);
              try { return JSON.parse(sub); } catch {}
            }
            return null;
          };

          const parsed = extractJson(text);
          if (!parsed) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'LLM did not return valid JSON' }));
            return;
          }

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(parsed));
        } catch (e: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Proxy error', detail: String(e?.message || e) }));
        }
      });
    }
  }
}

export default defineConfig(({ mode }) => ({
  // Absolute base so dynamic chunk URLs work no matter which client-side route
  // the user lands on first (e.g. /haendler). Firebase rewrites every unknown
  // path to /index.html, and HTML-relative paths break for those routes — so
  // every chunk reference is rooted at "/" instead of "./".
  base: '/',
  plugins: [react(), aiProxyPlugin()],
  resolve: {
    // `@/` alias resolves to src/. Required by shadcn/ui copy-paste components
    // and matches the path convention in components.json.
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Split heavy vendor libraries into their own chunks so:
        //   - Monaco (loaded only via React.lazy in HaseEditor) doesn't bloat
        //     the initial download — it stays in a separate chunk that the
        //     browser fetches the first time the dealer opens the editor.
        //   - Firebase / Chart.js / TensorFlow ship as separate cacheable
        //     bundles. When app code changes the user only re-downloads the
        //     small app chunk; vendors stay in the browser cache.
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;
          // Monaco stays lazy: it's still pulled via React.lazy in HaseEditor
          // and we want the editor chunk to fetch on first open, not on
          // initial paint.
          if (id.includes('@monaco-editor') || id.includes('monaco-editor')) return 'monaco';
          if (id.includes('@tensorflow')) return 'tfjs';
          // React itself + every package that calls React.forwardRef (or
          // anything React.* really) at module top level MUST share a chunk
          // with React. If they are split apart, Rollup wires the
          // cross-chunk namespace import in a way that lets the consumer
          // execute before React's default export is initialised, and you
          // get a prod-only "Cannot read properties of undefined (reading
          // 'forwardRef')" in the consumer chunk. Local dev does not hit
          // this because manualChunks is a build-time concern.
          // See: https://github.com/vitejs/vite/issues/5142 (and friends).
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/scheduler/') ||
            id.includes('node_modules/react-chartjs') ||
            id.includes('node_modules/react-i18next') ||
            id.includes('node_modules/lucide-react')
          ) return 'react';
          // chart.js itself + plugins are pure JS — safe to split off,
          // since they don't touch React.* at top level.
          if (id.includes('chart.js') || id.includes('chartjs-')) return 'charts';
          if (id.includes('firebase')) return 'firebase';
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 1024,
  },
  // Production-only: strip the noisiest console calls on minify. We deliberately
  // keep `console.error` and `console.warn` because they surface real failures
  // we want visible in dealer DevTools when something breaks in the field.
  esbuild: mode === 'production'
    ? { pure: ['console.log', 'console.debug', 'console.info'] }
    : undefined,
  publicDir: 'public',
  server: {
    fs: {
      // Allow serving files from src/data directory
      allow: ['..', 'src/data']
    }
  },
  assetsInclude: ['**/*.csv'] // Include CSV files as assets
}))
