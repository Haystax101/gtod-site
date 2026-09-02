import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()
// GDPR retention: uploaded document text is deleted 30 days after upload.
crons.daily('purge expired attachments', { hourUTC: 3, minuteUTC: 15 }, internal.attachments.purgeExpired)

// Cost accuracy: a call whose tab crashed or whose network dropped never
// reports an end. Left alone those sessions would under-report spend, so they
// are closed at their reserved ceiling. Runs often because the longer a dead
// session sits open, the longer the concurrency limit blocks the user from
// starting a new one.
crons.interval('reconcile abandoned voice sessions', { minutes: 5 }, internal.voice.expireStale)

// Monday morning: rebuild everyone's week. Safe to run repeatedly because
// every write is deduplicated, so a retry or a manual run cannot double up a
// user's task list.
crons.weekly(
  'generate weekly tasks',
  { dayOfWeek: 'monday', hourUTC: 6, minuteUTC: 0 },
  internal.timeline.generateWeeklyTasks,
)
export default crons
