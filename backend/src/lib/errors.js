// Error codes and the JSON response envelope (DEC-004).

/** HTTP status per error code. */
export const ERROR_STATUS = {
  VALIDATION: 400,
  NOT_SUPPORTED: 400,
  UPSTREAM_AUTH: 401,
  MANAGED_BY_BACKEND: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL: 500,
  UPSTREAM_ERROR: 502,
  NOT_CONNECTED: 503,
  UPSTREAM_TIMEOUT: 504,
};

export class AppError extends Error {
  /**
   * @param {keyof ERROR_STATUS} code
   * @param {string} message
   * @param {object} [extra]  e.g. { upstream: <server error message> }
   */
  constructor(code, message, extra = undefined) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code] ?? 500;
    this.extra = extra;
  }
}

/** @param {unknown} data */
export const ok = data => ({ ok: true, data: data ?? null });

/** @param {AppError} err */
export const fail = err => ({ ok: false, error: { code: err.code, message: err.message, ...err.extra } });

/** Express handler for unmatched /api routes. */
export function apiNotFound(req, _res, next) {
  next(new AppError('NOT_FOUND', `No such endpoint: ${req.method} ${req.originalUrl}`));
}

/**
 * Express error middleware: converts anything thrown into the envelope.
 * @param {ReturnType<import('./logger.js').createLogger>} log
 */
export function errorHandler(log) {
  // eslint-disable-next-line no-unused-vars
  return (err, _req, res, _next) => {
    let appErr = err;
    if (!(err instanceof AppError)) {
      if (err?.type === 'entity.parse.failed') appErr = new AppError('VALIDATION', 'Request body is not valid JSON');
      else {
        log.error('Unhandled error', err);
        appErr = new AppError('INTERNAL', 'Internal server error');
      }
    }
    res.status(appErr.status).json(fail(appErr));
  };
}
