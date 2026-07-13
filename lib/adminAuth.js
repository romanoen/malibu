const crypto = require('crypto');

const ADMIN_SESSION_COOKIE_NAME = 'admin_session';
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_BLOCK_DURATION_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

const sessions = new Map();
const revokedSessionNonces = new Map();
const loginAttempts = new Map();

function getAdminPassword() {
  if (process.env.ADMIN_PASSWORD) {
    return process.env.ADMIN_PASSWORD;
  }

  if (process.env.NODE_ENV === 'production') {
    return null;
  }

  return 'admin123';
}

function secureCompare(value, expectedValue) {
  const valueBuffer = Buffer.from(String(value || ''));
  const expectedBuffer = Buffer.from(String(expectedValue || ''));

  return (
    valueBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(valueBuffer, expectedBuffer)
  );
}

function getSessionSecret() {
  return process.env.ADMIN_SESSION_SECRET || getAdminPassword() || 'malibu-local-admin-session';
}

function signSessionPayload(payload) {
  return crypto
    .createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest('hex');
}

function createSignedSessionToken(session) {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  const signature = signSessionPayload(payload);
  return `${payload}.${signature}`;
}

function verifySignedSessionToken(token, now = Date.now(), options = {}) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) {
    return null;
  }

  const expectedSignature = signSessionPayload(payload);
  if (!secureCompare(signature, expectedSignature)) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session || session.expires <= now || !session.nonce) {
      return null;
    }

    if (!options.ignoreRevocation && revokedSessionNonces.has(session.nonce)) {
      return null;
    }

    return {
      loggedIn: true,
      expires: session.expires,
      nonce: session.nonce
    };
  } catch (error) {
    return null;
  }
}

function parseCookies(cookieHeader = '') {
  return cookieHeader
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex === -1) {
        return cookies;
      }

      const key = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      try {
        cookies[key] = decodeURIComponent(value);
      } catch (error) {
        cookies[key] = value;
      }
      return cookies;
    }, {});
}

function getSessionIdFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[ADMIN_SESSION_COOKIE_NAME] || req.headers['x-session-id'] || null;
}

function cleanupExpiredSessions(now = Date.now()) {
  for (const [sessionId, session] of sessions.entries()) {
    if (!session || session.expires <= now) {
      sessions.delete(sessionId);
    }
  }

  for (const [nonce, expires] of revokedSessionNonces.entries()) {
    if (expires <= now) {
      revokedSessionNonces.delete(nonce);
    }
  }
}

function createAdminSession(now = Date.now()) {
  cleanupExpiredSessions(now);

  const session = {
    loggedIn: true,
    expires: now + SESSION_DURATION_MS,
    nonce: crypto.randomBytes(16).toString('hex')
  };
  const sessionId = createSignedSessionToken(session);
  sessions.set(sessionId, session);

  return sessionId;
}

function getAdminSession(req, now = Date.now()) {
  cleanupExpiredSessions(now);

  const sessionId = getSessionIdFromRequest(req);
  if (!sessionId) {
    return null;
  }

  const memorySession = sessions.get(sessionId);
  if (memorySession && memorySession.loggedIn && memorySession.expires > now) {
    return { sessionId, session: memorySession };
  }

  const signedSession = verifySignedSessionToken(sessionId, now);
  if (signedSession) {
    return { sessionId, session: signedSession };
  }

  if (memorySession) {
    sessions.delete(sessionId);
  }
  return null;
}

function destroyAdminSession(req) {
  const sessionId = getSessionIdFromRequest(req);
  if (sessionId) {
    const signedSession = verifySignedSessionToken(sessionId, Date.now(), {
      ignoreRevocation: true
    });
    if (signedSession?.nonce) {
      revokedSessionNonces.set(signedSession.nonce, signedSession.expires);
    }
    sessions.delete(sessionId);
  }
}

function createSessionCookie(sessionId) {
  const parts = [
    `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_DURATION_MS / 1000)}`
  ];

  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function createClearedSessionCookie() {
  const parts = [
    `${ADMIN_SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  ];

  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function getLoginAttemptKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function cleanupExpiredLoginAttempts(now = Date.now()) {
  for (const [key, attempt] of loginAttempts.entries()) {
    if (!attempt) {
      loginAttempts.delete(key);
      continue;
    }

    const hasExpiredWindow = attempt.firstAttemptAt + LOGIN_WINDOW_MS <= now;
    const isNoLongerBlocked = !attempt.blockedUntil || attempt.blockedUntil <= now;

    if (hasExpiredWindow && isNoLongerBlocked) {
      loginAttempts.delete(key);
    }
  }
}

function getLoginThrottleState(req, now = Date.now()) {
  cleanupExpiredLoginAttempts(now);

  const key = getLoginAttemptKey(req);
  const attempt = loginAttempts.get(key);

  if (attempt?.blockedUntil && attempt.blockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((attempt.blockedUntil - now) / 1000)
    };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

function registerFailedLogin(req, now = Date.now()) {
  const key = getLoginAttemptKey(req);
  const attempt = loginAttempts.get(key);

  if (!attempt || attempt.firstAttemptAt + LOGIN_WINDOW_MS <= now) {
    loginAttempts.set(key, {
      count: 1,
      firstAttemptAt: now,
      blockedUntil: null
    });
    return getLoginThrottleState(req, now);
  }

  attempt.count += 1;

  if (attempt.count >= MAX_LOGIN_ATTEMPTS) {
    attempt.blockedUntil = now + LOGIN_BLOCK_DURATION_MS;
  }

  loginAttempts.set(key, attempt);
  return getLoginThrottleState(req, now);
}

function clearFailedLogins(req) {
  loginAttempts.delete(getLoginAttemptKey(req));
}

function resetAdminAuthState() {
  sessions.clear();
  revokedSessionNonces.clear();
  loginAttempts.clear();
}

module.exports = {
  ADMIN_SESSION_COOKIE_NAME,
  MAX_LOGIN_ATTEMPTS,
  clearFailedLogins,
  createAdminSession,
  createClearedSessionCookie,
  createSessionCookie,
  destroyAdminSession,
  getAdminPassword,
  getAdminSession,
  getLoginThrottleState,
  registerFailedLogin,
  resetAdminAuthState,
  secureCompare
};
