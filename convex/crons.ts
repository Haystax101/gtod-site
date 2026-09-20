import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

// Recordings left over from the voice-evidence era: deleted 30 days after review.
crons.daily('purge reviewed evidence', { hourUTC: 3, minuteUTC: 15 }, internal.missions.purgeEvidence)
crons.daily('purge login attempts', { hourUTC: 3, minuteUTC: 40 }, internal.agents.purgeLoginAttempts)
crons.daily('purge expired sessions', { hourUTC: 3, minuteUTC: 30 }, internal.agents.purgeExpiredSessions)
// Nothing should be able to sit outside HQ's queue unseen.
crons.interval('rescue stuck submissions', { minutes: 15 }, internal.missions.rescueStuck)

export default crons
