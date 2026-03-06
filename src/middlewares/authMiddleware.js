const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
  // 1. Get token from the header (Format: Authorization: Bearer <token>)
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  try {
    // 2. Verify the token using your secret
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'change-me');
    
    // 3. Attach the user data to the request object so the next function can use it
    req.user = decoded; 
    next(); // Pass control to the next middleware
  } catch (error) {
    res.status(403).json({ message: 'Invalid or expired token.' });
  }
};

const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return next();
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'change-me');
  } catch (error) {
    req.user = null;
  }

  return next();
};

const isAdmin = (req, res, next) => {
  // This runs AFTER verifyToken, so req.user is already populated
  if (req.user && req.user.role === 'ADMIN') {
    next();
  } else {
    res.status(403).json({ message: 'Access restricted to administrators only.' });
  }
};

module.exports = { verifyToken, optionalAuth, isAdmin };