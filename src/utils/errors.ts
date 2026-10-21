export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown): AppError =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const forbidden = (message: string): AppError => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message: string): AppError => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message: string): AppError => new AppError(409, 'CONFLICT', message);
