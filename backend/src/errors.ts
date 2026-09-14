export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(400, code, message, details);

export const forbidden = (message = "You do not have permission to perform this action.") =>
  new AppError(403, "FORBIDDEN", message);

export const notFound = (resource: string) =>
  new AppError(404, "NOT_FOUND", `${resource} was not found.`);

export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(409, code, message, details);
