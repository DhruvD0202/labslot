import bcrypt from 'bcryptjs';
import { loginInput, registerInput } from '../validation.js';
import { signToken } from '../middleware/auth.js';

export function authController(pool, secret) {
  return {
    login: async (req, res) => {
      const input = loginInput.parse(req.body);
      const { rows } = await pool.query('SELECT * FROM users WHERE email = $1 AND is_active', [input.email]);
      const user = rows[0];
      if (!user || !(await bcrypt.compare(input.password, user.password_hash))) {
        return res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' });
      }
      const { password_hash, is_active, created_at, ...profile } = user;
      res.json({ user: profile, token: signToken(user, secret) });
    },
    register: async (req, res) => {
      const input = registerInput.parse(req.body);
      const hash = await bcrypt.hash(input.password, 12);
      // No user-controlled role field: self-registration ALWAYS creates students.
      const { rows } = await pool.query(`INSERT INTO users(name,email,password_hash,role) VALUES ($1,$2,$3,'student')
        RETURNING id,name,email,role`, [input.name, input.email, hash]);
      res.status(201).json({ user: rows[0], token: signToken(rows[0], secret) });
    },
  };
}
