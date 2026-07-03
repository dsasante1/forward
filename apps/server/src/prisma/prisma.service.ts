import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * The single database handle for the app. Connects to Supabase Postgres via the
 * pooled `DATABASE_URL`. All persistence goes through here — there is no other
 * writer (the previous Firebase-direct model had every client writing the DB
 * directly; now the server is the only one holding credentials).
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // Every project-scoped handler runs inside an interactive transaction
    // (withUser), so under concurrent load transactions queue for pool
    // connections. The defaults (maxWait 2s) fail-fast the whole API the
    // moment the pool is briefly saturated (see the 2026-07-02 outage);
    // queue instead, and let genuinely stuck work be cut off at `timeout`.
    super({
      transactionOptions: { maxWait: 10_000, timeout: 20_000 },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log("Connected to Postgres");
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Run `fn` inside a transaction that has `app.user_id` set, so Postgres RLS
   * (prisma/rls.sql) can scope every statement to the authenticated user as a
   * second wall behind the service-layer membership checks. Use for any handler
   * that touches project-scoped tables.
   */
  async withUser<T>(
    userId: string,
    fn: (tx: PrismaClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      // set_config(..., true) = LOCAL to this transaction only.
      await tx.$executeRawUnsafe(
        "SELECT set_config('app.user_id', $1, true)",
        userId,
      );
      return fn(tx as unknown as PrismaClient);
    });
  }
}
