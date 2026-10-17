import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiError, ErrorCode } from '@necta/contracts';
import type { Response } from 'express';
import { ZodError, type ZodType } from 'zod';

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number = HttpStatus.BAD_REQUEST,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Error de regla de negocio: la operación se rechaza sin efectos. */
export class BusinessError extends AppError {
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(code, message, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }
}

export class VersionConflictError extends AppError {
  constructor(readonly remote: unknown) {
    super('VERSION_CONFLICT', 'La entidad cambió desde tu última versión', HttpStatus.CONFLICT, { remote });
  }
}

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', 'Datos inválidos', HttpStatus.BAD_REQUEST, zodIssues(result.error));
  }
  return result.data;
}

export function zodIssues(error: ZodError): { path: string; message: string }[] {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ApiError = { code: 'INTERNAL_ERROR', message: 'Error interno' };

    if (exception instanceof AppError) {
      status = exception.status;
      body = { code: exception.code, message: exception.message, details: exception.details };
    } else if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      body = { code: 'VALIDATION_ERROR', message: 'Datos inválidos', details: zodIssues(exception) };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const code: ErrorCode =
        status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR';
      body = { code, message: exception.message };
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    res.status(status).json(body);
  }
}
