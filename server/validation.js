import { z } from 'zod';
import { DateTime } from 'luxon';

const campusTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/, 'Use a campus-local date and time without a timezone offset.')
  .refine(value => DateTime.fromISO(value, { zone: 'Asia/Kolkata' }).isValid, 'Invalid calendar date.');
export const id = z.uuid();
const interval = {
  equipment_id: id,
  start_time: campusTime,
  end_time: campusTime,
  reason: z.string().trim().min(1).max(500),
};
const ordered = data => data.start_time < data.end_time;
export const bookingInput = z.object({ ...interval, override_reason: z.string().trim().min(5).max(500).optional() })
  .strict().refine(ordered, { message: 'End time must be after start time.', path: ['end_time'] });
export const intervalInput = z.object(interval).strict()
  .refine(ordered, { message: 'End time must be after start time.', path: ['end_time'] });
export const calendarInput = z.object({
  equipment_id: id, start: campusTime, end: campusTime,
}).refine(data => {
  const start = DateTime.fromISO(data.start, { zone: 'Asia/Kolkata' });
  const end = DateTime.fromISO(data.end, { zone: 'Asia/Kolkata' });
  const days = end.diff(start, 'days').days;
  return days > 0 && days <= 100;
}, 'Choose a calendar window of at most 100 days.');
export const loginInput = z.object({ email: z.email().trim().toLowerCase(), password: z.string().min(1).max(128) }).strict();
export const registerInput = z.object({
  name: z.string().trim().min(1).max(100), email: z.email().trim().toLowerCase(),
  password: z.string().min(12).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes.'),
}).strict();
export const cancelInput = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
export const notesInput = z.object({ notes: z.string().trim().max(2000).default('') }).strict();
