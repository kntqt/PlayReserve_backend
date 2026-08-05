/**
 * requireRole — Role-based access control middleware.
 * 
 * Usage: requireRole(['admin', 'staff'])
 * Must be used AFTER requireAuth middleware.
 * Returns 403 if req.user.role is not in the allowed roles.
 */
const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Forbidden. You do not have permission to access this resource.' 
      });
    }

    next();
  };
};

module.exports = { requireRole };
