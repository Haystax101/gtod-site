import { Link } from 'react-router-dom'

const UPDATED = '2 September 2026'

export function Privacy() {
  return (
    <main className="legal-page">
      <div className="wrap">
        <h1>Privacy policy</h1>
        <div className="updated">Last updated {UPDATED}</div>
        <p>
          Get There One Day ("GTOD", "we") runs getthereoneday.com, the Degree Apprenticeship Playbook and Charge, our
          apprenticeship advice assistant. This policy explains what we collect and why. By using the site you confirm
          you are 18 or over, or have a parent or guardian's permission.
        </p>
        <h2>What we collect</h2>
        <ul>
          <li><b>Account details.</b> When you create an account we store your name and email address. Sign-in is handled by Clerk.</li>
          <li><b>Conversations with Charge.</b> The messages you send and the replies you receive are stored so you can return to them. They are sent to the AI provider that powers your plan (DeepSeek for Flash, xAI for Pro) to generate a reply.</li>
          <li><b>Documents you upload.</b> CVs and cover letters are converted to plain text in your browser. We keep only that text, never the file, and delete it automatically 30 days after upload. You can delete it sooner from within Charge.</li>
          <li><b>Payment details.</b> Payments are processed by Stripe. We never see your card number. We store your Stripe customer ID and subscription status.</li>
          <li><b>Usage.</b> We count messages and tokens to enforce plan limits, and use PostHog for anonymous product analytics.</li>
          <li><b>Podcast questions.</b> Questions submitted through the form are emailed to us via FormSubmit.</li>
        </ul>
        <h2>How we use it</h2>
        <p>To run the service, generate replies, enforce fair-use limits, take payment, and improve the product. We do not sell your data and we do not use your conversations or documents to train AI models.</p>
        <h2>Who we share it with</h2>
        <p>Only the processors needed to run the service: Clerk (authentication), Convex (database and hosting), Stripe (payments), DeepSeek and xAI (AI replies), PostHog (analytics) and FormSubmit (question form). Some of these process data outside the UK; where they do, they rely on standard contractual clauses or equivalent safeguards.</p>
        <h2>Your rights</h2>
        <p>Under UK GDPR you can ask for a copy of your data, ask us to correct or delete it, or object to how we use it. Deleting your account removes your conversations and documents. Email <a href="mailto:questions@getthereoneday.com">questions@getthereoneday.com</a> for anything else.</p>
        <h2>Retention</h2>
        <p>Uploaded document text: 30 days. Conversations: until you delete them or your account. Payment records: as long as required for tax and accounting.</p>
        <p>See also our <Link to="/terms">terms of use</Link>.</p>
      </div>
    </main>
  )
}

export function Terms() {
  return (
    <main className="legal-page">
      <div className="wrap">
        <h1>Terms of use</h1>
        <div className="updated">Last updated {UPDATED}</div>
        <h2>Who can use Charge</h2>
        <p>You must be 18 or over to create an account or subscribe. If you are younger, a parent or guardian must create the account and agree to these terms on your behalf.</p>
        <h2>What Charge is</h2>
        <p>Charge is an AI assistant that gives general guidance on applying for degree apprenticeships, based on GTOD's own advice. It is not a careers adviser, recruiter or employer, and it can be wrong. Check anything important, especially deadlines, entry requirements and company details, against the official source. Decisions you make based on its advice are your own.</p>
        <h2>Fair use</h2>
        <p>Each plan includes a message and usage allowance shown inside Charge. We may adjust allowances to keep the service sustainable. Don't use Charge to generate spam, to harass people, or to attempt to extract other users' data.</p>
        <h2>Payments</h2>
        <p>Pro is billed monthly through Stripe at the price shown at checkout and renews automatically until cancelled. Cancel any time from the "Manage billing" button; you keep Pro until the end of the period you've paid for. We don't offer refunds for partial months, except where the law requires.</p>
        <h2>Your content</h2>
        <p>You own what you upload and write. You give us permission to process it to provide the service, as set out in the <Link to="/privacy">privacy policy</Link>. Don't upload documents you don't have the right to share.</p>
        <h2>Liability</h2>
        <p>The service is provided as-is. To the extent the law allows, GTOD is not liable for losses arising from your use of Charge or reliance on its output. Nothing in these terms limits liability that can't be limited under UK law.</p>
        <h2>Changes</h2>
        <p>We may update these terms; we'll show the date at the top. Continuing to use the service after a change means you accept it.</p>
        <p>Questions: <a href="mailto:questions@getthereoneday.com">questions@getthereoneday.com</a></p>
      </div>
    </main>
  )
}
