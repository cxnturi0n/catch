// Typed HTTP errors that flow through the global error handler unchanged.
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, 'NOT_FOUND', `${what} not found`)
export const forbidden = (message = 'Forbidden') => new HttpError(403, 'FORBIDDEN', message)
export const badRequest = (message: string, code = 'BAD_REQUEST') => new HttpError(400, code, message)
export const conflict = (message: string) => new HttpError(409, 'CONFLICT', message)
