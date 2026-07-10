import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { Public } from "./auth/public.decorator.js";
import { PrismaService } from "./prisma/prisma.service.js";

@Controller()
@SkipThrottle()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liveness probe for Cloud Run — no auth required. Deliberately touches the
   * DB pool: a process whose Prisma pool is wedged (every request timing out
   * waiting for a connection, as in the 2026-07-02 outage) must fail this
   * probe so Cloud Run recycles the instance instead of serving 500s forever.
   */
  @Public()
  @Get("healthz")
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException("database unreachable");
    }
    return { status: "ok", at: new Date().toISOString() };
  }
}
