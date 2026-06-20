import { Controller, Get } from "@nestjs/common";
import { Public } from "./auth/public.decorator.js";

@Controller()
export class HealthController {
  /** Liveness probe for Cloud Run — no auth required. */
  @Public()
  @Get("healthz")
  health() {
    return { status: "ok", at: new Date().toISOString() };
  }
}
