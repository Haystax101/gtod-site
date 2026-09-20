import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Two entries: the landing page (index.html, static, untouched) and the agents
// app (agents/index.html), which React Router owns under /agents/*.
// Hashed build output goes to /static so it never collides with public/assets,
// which the landing page references by plain relative URL.
// Dev-server twin of public/.htaccess: deep links under /agents/ serve the
// agents shell instead of falling through to the landing page.
const agentsFallback = {
  name: 'agents-spa-fallback',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const url = req.url.split('?')[0]
      if (/^\/agents(\/|$)/.test(url) && !/\.[a-z0-9]+$/i.test(url)) req.url = '/agents/index.html'
      next()
    })
  },
}

export default defineConfig({
  plugins: [react(), agentsFallback],
  resolve: { alias: { '@gen': resolve(__dirname, 'convex/_generated') } },
  build: {
    assetsDir: 'static',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        agents: resolve(__dirname, 'agents/index.html'),
      },
    },
  },
  server: { port: 5173 },
})
