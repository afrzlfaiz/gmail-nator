export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class ConflictError extends AppError {
  constructor(message = "Resource already exists") {
    super(409, "CONFLICT", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(404, "NOT_FOUND", message);
  }
}

export function isConflictError(error: unknown) {
  return error instanceof ConflictError || (typeof error === "object" && error !== null && "code" in error && error.code === "23505");
}
