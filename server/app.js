import express from 'express';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { apiRouter } from './routes/api.js';

export function createApp(pool, config) {
  const app = express();
  app.disable('x-powered-by');
  // FullCalendar sets inline styles. Scripts remain restricted to this origin.
  app.use(helmet({ contentSecurityPolicy: { directives: {
    'script-src': ["'self'"], 'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:'], 'connect-src': ["'self'"],
    'upgrade-insecure-requests': config.production ? [] : null,
  } } }));
  app.use(express.json({ limit: '20kb' }));
  app.use('/api', apiRouter(pool, config));
  app.use('/api', (req, res) => res.status(404).json({ code:'NOT_FOUND', message:'API endpoint not found.' }));
  const dist = fileURLToPath(new URL('../dist/', import.meta.url));
  if (existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get('/{*path}', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  app.use((error, req, res, next) => {
    if (error instanceof ZodError) return res.status(400).json({ code:'VALIDATION_ERROR', message:error.issues[0]?.message || 'Invalid input.', issues:error.issues });
    const mapped = {
      '23P01': [409,'SLOT_CONFLICT','That interval is already reserved. Choose another time or join the waitlist.'],
      '23505': [409,'DUPLICATE','This email, waiting request, or usage record already exists.'],
      '23503': [400,'INVALID_REFERENCE','The referenced record does not exist.'],
      '23514': [400,'INVALID_DATA','The request violates a database rule. Check its fields and time interval.'],
      '22023': [400,'INVALID_REQUEST',error.message],
      '42501': [403,'FORBIDDEN',error.message],
      'P0001': [409,'POLICY_CONFLICT',error.message],
      'P0002': [404,'NOT_FOUND',error.message],
      '55P03': [409,'BUSY','This equipment is being updated. Please try again.'],
      '40P01': [409,'RETRY','Another scheduling change ran at the same time. Please retry.'],
      '40001': [409,'RETRY','Another scheduling change ran at the same time. Please retry.'],
      '57014': [503,'BUSY','The request timed out. Please try again.'],
    }[error.code];
    if (mapped) return res.status(mapped[0]).json({ code:mapped[1], message:mapped[2] });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ code:'INVALID_JSON', message:'Invalid JSON request.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ code:'TOO_LARGE', message:'Request is too large.' });
    console.error('Request failed:', error.code || error.name, error.message);
    res.status(500).json({ code:'INTERNAL_ERROR', message:'Something went wrong. Please try again.' });
  });
  return app;
}
