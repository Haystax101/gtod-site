import { query, internalMutation } from '../../convex/_generated/server'
import { v } from 'convex/values'
export const foo = query({ args: { a: v.string() }, handler: async () => 1 })
export const bar = internalMutation({ args: {}, handler: async () => 1 })
export function pure(n: number): number { return n * 2 }
console.log('loaded ok', typeof foo, pure(21))
