import type {
  AlertEntity,
  BankEntity,
  BaselineEntity,
  CommitmentEntity,
  CommitmentInput,
  CounterpartyEntity,
  ForecastResponse,
  MovementEntity,
  MovementInput,
  PayableEntity,
  ReceivableEntity,
  SaleEntity,
  SessionResponse,
} from '@necta/contracts';
import { http } from './client';

interface Applied<T> {
  entity: T;
  seq: number;
}

export const api = {
  login: (email: string, password: string) => http.post<SessionResponse>('/v2/auth/login', { email, password }),
  me: () => http.get<SessionResponse>('/v2/auth/me'),
  logout: () => http.post<void>('/v2/auth/logout'),

  forecast: () => http.get<ForecastResponse>('/v2/forecast/14d'),
  banks: () => http.get<BankEntity[]>('/v2/banks'),
  counterparties: () => http.get<CounterpartyEntity[]>('/v2/counterparties'),
  receivables: () => http.get<ReceivableEntity[]>('/v2/receivables?status=open'),
  allReceivables: () => http.get<ReceivableEntity[]>('/v2/receivables'),
  allPayables: () => http.get<PayableEntity[]>('/v2/payables'),
  sales: (from: string) => http.get<SaleEntity[]>(`/v2/sales?from=${from}`),
  baseline: () => http.get<BaselineEntity | null>('/v2/cash-baseline'),
  payables: () => http.get<PayableEntity[]>('/v2/payables?status=open'),
  movements: () => http.get<MovementEntity[]>('/v2/movements'),
  commitments: () => http.get<CommitmentEntity[]>('/v2/commitments'),
  alerts: () => http.get<AlertEntity[]>('/v2/alerts'),

  createMovement: (clientMutationId: string, movement: MovementInput) =>
    http.post<Applied<MovementEntity>>('/v2/movements', { clientMutationId, movement }),
  updateMovement: (id: string, body: { clientMutationId: string; baseVersion: number; changes: { amount?: number; description?: string; date?: string } }) =>
    http.patch<Applied<MovementEntity>>(`/v2/movements/${id}`, body),
  deleteMovement: (id: string, body: { clientMutationId: string; baseVersion: number }) => http.delete<Applied<MovementEntity>>(`/v2/movements/${id}`, body),
  voidPayment: (kind: 'receivable' | 'payable', debtId: string, paymentId: string, clientMutationId: string) =>
    http.post<Applied<ReceivableEntity>>(`/v2/${kind === 'receivable' ? 'receivables' : 'payables'}/${debtId}/payments/${encodeURIComponent(paymentId)}/void`, { clientMutationId }),
  collect: (receivableId: string, body: { clientMutationId: string; bankId: string; amount: number; paymentDate: string; method: string }) =>
    http.post<Applied<ReceivableEntity>>(`/v2/receivables/${receivableId}/payments`, body),
  reschedule: (receivableId: string, body: { clientMutationId: string; baseVersion: number; newDueDate: string }) =>
    http.post<Applied<ReceivableEntity>>(`/v2/receivables/${receivableId}/reschedule`, body),
  pay: (payableId: string, body: { clientMutationId: string; bankId: string; amount: number; paymentDate: string; method: string }) =>
    http.post<Applied<PayableEntity>>(`/v2/payables/${payableId}/payments`, body),
  createSale: (clientMutationId: string, sale: { id: string; customerId: string; amount: number; paid: boolean; bankId: string; saleDate: string; expiresAt: string | null }) =>
    http.post<{ results: { status: string; error?: { code: string; message: string } }[] }>('/v2/sale/batch', {
      batchId: `web_${clientMutationId}`,
      sales: [
        {
          clientMutationId,
          sale: {
            id: sale.id,
            customerId: sale.customerId,
            items: [{ itemId: 'venta_general', quantitiesSold: 1, finalPrice: sale.amount }],
            payments: sale.paid ? [{ bankId: sale.bankId, amount: sale.amount, method: 'efectivo', paymentDate: sale.saleDate }] : [],
            saleDate: sale.saleDate,
            expiresAt: sale.paid ? null : sale.expiresAt,
          },
        },
      ],
    }),
  createCommitment: (clientMutationId: string, commitment: CommitmentInput) =>
    http.post<Applied<CommitmentEntity>>('/v2/commitments', { clientMutationId, commitment }),
  deleteCommitment: (id: string, clientMutationId: string, baseVersion: number) =>
    http.delete<Applied<CommitmentEntity>>(`/v2/commitments/${id}`, { clientMutationId, baseVersion }),
  ackAlert: (id: string) => http.post<AlertEntity>(`/v2/alerts/${id}/ack`),
};
