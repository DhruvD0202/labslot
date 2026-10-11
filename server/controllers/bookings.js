import { bookingInput, intervalInput, cancelInput, id } from '../validation.js';
import { reserve, cancel, joinWaitlist } from '../services/bookings.js';

export function bookingController(pool) {
  return {
    create: async (req, res) => res.status(201).json(await reserve(pool, req.user, bookingInput.parse(req.body))),
    maintenance: async (req, res) => res.status(201).json(await reserve(pool, req.user, intervalInput.parse(req.body), 'maintenance')),
    cancel: async (req, res) => res.json(await cancel(pool, req.user, id.parse(req.params.id), cancelInput.parse(req.body).reason)),
    waitlist: async (req, res) => res.status(201).json(await joinWaitlist(pool, req.user, intervalInput.parse(req.body))),
  };
}
