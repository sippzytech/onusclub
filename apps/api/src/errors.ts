import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "./logger.js";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, "bad_request", message, details);
  }
  static unauthorized(message = "unauthorized"): ApiError {
    return new ApiError(401, "unauthorized", message);
  }
  static notFound(message = "not found"): ApiError {
    return new ApiError(404, "not_found", message);
  }
  static conflict(message: string): ApiError {
    return new ApiError(409, "conflict", message);
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: "validation_error", message: "invalid request", details: err.flatten() },
    });
    return;
  }
  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }
  logger.error({ err }, "unhandled error");
  res.status(500).json({ error: { code: "internal_error", message: "internal error" } });
}
