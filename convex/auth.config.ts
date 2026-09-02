// Clerk issues the JWTs Convex verifies. Set CLERK_JWT_ISSUER_DOMAIN in the
// Convex dashboard to the "Issuer" shown on the Clerk JWT template named "convex"
// (looks like https://something.clerk.accounts.dev).
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: 'convex',
    },
  ],
}
