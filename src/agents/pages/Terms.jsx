export default function Terms() {
  return (
    <div className="gate" style={{ alignItems: 'start' }}>
      <div className="gate-box" style={{ maxWidth: 640 }}>
        <a href="/agents/" className="backlink">← Field Operations</a>
        <div className="card prose">
          <span className="eyebrow">Programme rules</span>
          <h1 className="display" style={{ margin: '6px 0 12px' }}>The small print</h1>
          <p className="small muted">Last updated 20 September 2026.</p>

          <h2 className="display">What this is</h2>
          <p>GTOD Field Operations is a free members' area for followers of Get There One Day. You get missions, ranks, a forum, and a direct line to the Lead Operative. It is run by the people behind the podcast, for fun.</p>

          <h2 className="display">Who can join</h2>
          <p>You must be 18 or over and sign up with your own TikTok username. HQ can remove any account at any time, for any reason, without notice. That is the whole moderation policy: be sound, and you will be fine.</p>

          <h2 className="display">Missions and recordings</h2>
          <ul>
            <li>Missions are light-hearted. Never harass anyone, never persist if someone is not up for it, and never record anyone who has asked you not to.</li>
            <li>Evidence is audio. Do not upload video of people's faces. Keep it short and keep it in public places.</li>
            <li>Recordings are analysed automatically (transcribed and checked by a model) and may be listened to by HQ. Nobody else can hear them. They are deleted 30 days after review.</li>
            <li>The verdict on a mission is final, but you can always plead your case on the direct line.</li>
          </ul>

          <h2 className="display">Your data</h2>
          <p>We store your TikTok username, a hashed password, what you post and submit, and when you were last here. No email, no name, no location. Log out on shared devices: there is no email reset, so if you forget your password, message @getthereonedaypod on TikTok and HQ will reset it.</p>
          <p>Donations are handled by Stripe. We never see your card details; we only learn that a donation was made and which agent it came from.</p>

          <h2 className="display">Forum</h2>
          <p>Posts are visible to members immediately. Slurs are hidden automatically. Anything else that should not be there, report it and HQ will deal with it.</p>

          <h2 className="display">Contact</h2>
          <p>questions@getthereoneday.com, or the direct line inside the app.</p>
        </div>
      </div>
    </div>
  )
}
