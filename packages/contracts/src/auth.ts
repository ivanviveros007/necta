import { z } from 'zod';
import { StoreInfoSchema } from './records';

export const LoginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const SessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
});
export type SessionUser = z.infer<typeof SessionUserSchema>;

export const SessionResponseSchema = z.object({
  user: SessionUserSchema,
  stores: z.array(StoreInfoSchema),
  expiresAt: z.string(),
  /** Solo para x-client-platform: mobile. La web recibe cookie HttpOnly. */
  accessToken: z.string().optional(),
  /** Solo para web: token CSRF (también en la cookie necta_csrf, legible por JS). */
  csrfToken: z.string().optional(),
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;
