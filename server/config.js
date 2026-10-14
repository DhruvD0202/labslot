import 'dotenv/config';

export function getConfig() {
  const { DATABASE_URL, JWT_SECRET } = process.env;
  if (!DATABASE_URL) throw new Error('DATABASE_URL is missing. Run npm run demo, or configure .env first.');
  if (!JWT_SECRET || JWT_SECRET.length < 32 || JWT_SECRET.startsWith('replace-')) {
    throw new Error('Set JWT_SECRET to a random string of at least 32 characters. npm run demo generates one.');
  }
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 5) {
    throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 5, matching the hosting proxy path.');
  }
  return {
    databaseUrl: DATABASE_URL,
    jwtSecret: JWT_SECRET,
    port: Number(process.env.PORT || 3001),
    host: process.env.HOST || '127.0.0.1',
    production: process.env.NODE_ENV === 'production',
    trustProxyHops,
  };
}
