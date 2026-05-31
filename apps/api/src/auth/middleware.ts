import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../errors.js";
import { verifyJwt, type JwtPayload } from "./jwt.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: JwtPayload;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/.exec(header);
  if (!match) throw ApiError.unauthorized("missing bearer token");
  try {
    req.auth = verifyJwt(match[1]);
    next();
  } catch {
    throw ApiError.unauthorized("invalid or expired token");
  }
}

export function authContext(req: Request): JwtPayload {
  if (!req.auth) throw ApiError.unauthorized();
  return req.auth;
}
