/**
 * TAMTAP Auth Middleware
 * Session-based authentication for admin and teacher access
 * 
 * Contract: Role-based UI via JS logic (admin / teacher)
 * No public registration - admin creates all accounts
 */

/**
 * Require authenticated session
 * Blocks unauthenticated requests to protected routes
 */
function requireAuth(req, res, next) {
    if (req.session && req.session.user) {
        req.user = req.session.user;
        return next();
    }
    
    return res.status(401).json({ 
        success: false, 
        error: 'Authentication required' 
    });
}

/**
 * Require admin role
 * Must be used after requireAuth
 */
function requireAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ 
            success: false, 
            error: 'Authentication required' 
        });
    }
    
    if (req.user.role !== 'admin') {
        return res.status(403).json({ 
            success: false, 
            error: 'Admin access required' 
        });
    }
    
    return next();
}

/**
 * Require teacher or admin role
 * Must be used after requireAuth
 */
function requireTeacher(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ 
            success: false, 
            error: 'Authentication required' 
        });
    }
    
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
        return res.status(403).json({ 
            success: false, 
            error: 'Teacher or admin access required' 
        });
    }
    
    return next();
}

/**
 * Optional auth - populates req.user if session exists
 * Does not block request if not authenticated
 */
function optionalAuth(req, res, next) {
    if (req.session && req.session.user) {
        req.user = req.session.user;
    }
    return next();
}

module.exports = {
    requireAuth,
    requireAdmin,
    requireTeacher,
    optionalAuth
};
