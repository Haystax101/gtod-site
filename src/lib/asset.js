/**
 * Resolve a file in `public/` against the deployed base path.
 *
 * Vite rewrites asset URLs it can see at build time, but a string literal in
 * JSX is invisible to it. Hardcoding "/assets/logo.png" therefore worked on the
 * apex domain and 404'd on GitHub Pages, which serves the app from /gtod-site/.
 */
export const asset = (path) => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`
