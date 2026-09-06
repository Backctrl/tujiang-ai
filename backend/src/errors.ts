export class AppError extends Error {
  constructor(public code: string, public statusCode = 400, public details?: Record<string, unknown>) { super(code); }
}
