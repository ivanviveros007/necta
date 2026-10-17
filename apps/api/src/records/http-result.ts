import { HttpStatus } from '@nestjs/common';
import type { OperationResult } from '@necta/contracts';
import type { Response } from 'express';
import { AppError } from '../common/errors';

/** Traduce el resultado de una operación a HTTP para los endpoints REST (web y contratos existentes). */
export function sendOperationResult(result: OperationResult, res: Response): unknown {
  switch (result.status) {
    case 'applied':
      res.status(HttpStatus.CREATED);
      return { entity: result.entity, seq: result.seq };
    case 'duplicate':
      res.status(HttpStatus.OK).setHeader('Idempotent-Replayed', 'true');
      return { entity: result.entity, seq: result.seq };
    case 'conflict':
      throw new AppError('VERSION_CONFLICT', result.error?.message ?? 'Conflicto de versión', HttpStatus.CONFLICT, { remote: result.remote });
    default: {
      const code = result.error?.code ?? 'INTERNAL_ERROR';
      const status =
        code === 'IDEMPOTENCY_PAYLOAD_MISMATCH'
          ? HttpStatus.CONFLICT
          : code === 'NOT_FOUND'
            ? HttpStatus.NOT_FOUND
            : code === 'VALIDATION_ERROR'
              ? HttpStatus.BAD_REQUEST
              : HttpStatus.UNPROCESSABLE_ENTITY;
      throw new AppError(code, result.error?.message ?? 'Operación rechazada', status);
    }
  }
}
