import jwt from 'jsonwebtoken';

export function authenticate(pool, secret) {
  return async (req, res, next) => {
    const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) return res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Please sign in.' });
    let payload;
    try {
      payload = jwt.verify(token, secret, { algorithms: ['HS256'], issuer: 'labslot', audience: 'labslot-web' });
    } catch {
      return res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Your session expired. Please sign in again.' });
    }
    try {
      // JWT authenticates identity. Current DB state controls permissions, so a
      // deactivated user or changed role does not keep old access until JWT expiry.
      const { rows } = await pool.query('SELECT id, name, email, role FROM users WHERE id = $1 AND is_active', [payload.sub]);
      if (!rows[0]) return res.status(401).json({ code: 'UNAUTHENTICATED', message: 'This account is inactive.' });
      req.user = rows[0];
      next();
    } catch (error) { next(error); }
  };
}

export function facultyOnly(req, res, next) {
  if (req.user.role !== 'faculty') return res.status(403).json({ code: 'FORBIDDEN', message: 'Faculty access is required.' });
  next();
}

export function signToken(user, secret) {
  return jwt.sign({ role: user.role }, secret, {
    subject: user.id, expiresIn: '2h', algorithm: 'HS256', issuer: 'labslot', audience: 'labslot-web',
  });
}
