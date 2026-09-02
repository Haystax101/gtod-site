import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) {
      const base = new URL(specifier, context.parentURL)
      for (const ext of ['.ts', '.js']) {
        const cand = new URL(base.href + ext)
        if (existsSync(fileURLToPath(cand))) return { url: cand.href, shortCircuit: true }
      }
    }
    return next(specifier, context)
  },
})

const mod = await import('../../convex/users.ts')
console.log('users loaded', Object.keys(mod))
