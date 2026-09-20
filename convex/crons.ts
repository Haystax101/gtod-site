import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

// Evidence is kept 30 days after review, then deleted.
crons.daily('purge reviewed evidence', { hourUTC: 3, minuteUTC: 15 }, internal.missions.purgeEvidence)
crons.daily('purge login attempts', { hourUTC: 3, minuteUTC: 40 }, internal.agents.purgeLoginAttempts)
crons.daily('purge expired sessions', { hourUTC: 3, minuteUTC: 30 }, internal.agents.purgeExpiredSessions)
// A classifier that never came back must not swallow a submission.
crons.interval('rescue stuck submissions', { minutes: 15 }, internal.missions.rescueStuck)

export default crons
