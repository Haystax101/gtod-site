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

          <h2 className="display">Missions and field reports</h2>
          <ul>
            <li>Missions are light-hearted. Never harass anyone, and never persist if someone is not up for it.</li>
            <li>A mission is written up in your own words. No recordings, no photos, nothing taken of anyone else: just your story of what happened.</li>
            <li>Do not name or identify the person you asked. No surnames, no handles, no addresses. Keep it to the story.</li>
            <li>HQ reads every report and decides whether it earns a point. Approved reports are published inside the app, under your handle, for other members to read.</li>
            <li>The decision on a mission is final, but you can always plead your case on the direct line.</li>
          </ul>

          <h2 className="display">Your data</h2>
          <p>We store your TikTok username, a hashed password, what you post and the reports you file, and when you were last here. No email, no name, no location. Log out on shared devices: there is no email reset, so if you forget your password, message @getthereonedaypod on TikTok and HQ will reset it.</p>
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
