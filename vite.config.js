import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// BASE_PATH lets a GitHub Pages project-site build live under /<repo>/.
// Hostinger (the primary host) serves from the domain root, so it stays '/'.
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH || '/',
})
