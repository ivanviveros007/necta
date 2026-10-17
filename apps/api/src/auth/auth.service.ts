import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import type { SessionUser, StoreInfo } from '@necta/contracts';
import bcrypt from 'bcryptjs';
import type { Model } from 'mongoose';
import { ClockService } from '../common/clock.service';
import { AppError } from '../common/errors';
import { APP_CONFIG, type AppConfig } from '../config/config';
import type { Doc } from '../db/mappers';
import { MODELS } from '../db/schemas';

export interface TokenPayload {
  sub: string;
  email: string;
  exp?: number;
}

// Hash de referencia para que un email inexistente cueste lo mismo que una contraseña incorrecta.
const DUMMY_HASH = bcrypt.hashSync('necta-dummy-password', 10);

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(MODELS.User) private readonly users: Model<Doc>,
    @InjectModel(MODELS.Store) private readonly stores: Model<Doc>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly jwt: JwtService,
    private readonly clock: ClockService,
  ) {}

  async login(email: string, password: string): Promise<{ user: SessionUser; token: string; expiresAt: string }> {
    const user = await this.users.findOne({ email: email.toLowerCase() }).lean<Doc>();
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new AppError('UNAUTHENTICATED', 'Email o contraseña incorrectos', HttpStatus.UNAUTHORIZED);
    const expiresAt = new Date(Date.now() + this.config.jwtTtlSeconds * 1000).toISOString();
    const token = await this.jwt.signAsync({ sub: user._id, email: user.email } satisfies TokenPayload, {
      expiresIn: this.config.jwtTtlSeconds,
    });
    return { user: { id: user._id, email: user.email, name: user.name }, token, expiresAt };
  }

  async verify(token: string): Promise<TokenPayload> {
    try {
      return await this.jwt.verifyAsync<TokenPayload>(token);
    } catch {
      throw new AppError('UNAUTHENTICATED', 'Sesión vencida o inválida', HttpStatus.UNAUTHORIZED);
    }
  }

  async userWithStores(userId: string): Promise<{ user: SessionUser; storeIds: string[] } | null> {
    const user = await this.users.findById(userId).lean<Doc>();
    if (!user) return null;
    return { user: { id: user._id, email: user.email, name: user.name }, storeIds: user.storeIds ?? [] };
  }

  async storesInfo(storeIds: string[]): Promise<StoreInfo[]> {
    const docs = await this.stores.find({ _id: { $in: storeIds } }).lean<Doc[]>();
    return docs.map((s) => ({
      id: s._id,
      name: s.name,
      currency: s.currency,
      timeZone: s.timeZone,
      businessDate: this.clock.businessDate(s.timeZone),
      todayPolicy: this.clock.todayPolicy(),
    }));
  }

  async store(storeId: string): Promise<Doc | null> {
    return this.stores.findById(storeId).lean<Doc>();
  }
}
