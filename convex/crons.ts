import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()
// GDPR retention: uploaded document text is deleted 30 days after upload.
crons.daily('purge expired attachments', { hourUTC: 3, minuteUTC: 15 }, internal.attachments.purgeExpired)
export default crons
