const jwt = require('jsonwebtoken');
require('dotenv').config();

/**
 * requireAuth — Verifies JWT from Authorization header.
 * Attaches decoded payload to req.user = { id, role, email }
 * Returns 401 if token is missing or invalid.
 */
const requireAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = {
      id: decoded.id,
      role: decoded.role,
      email: decoded.email,
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired. Please refresh or log in again.' });
    }
    return res.status(401).json({ error: 'Invalid token.' });
  }
};

module.exports = { requireAuth };
