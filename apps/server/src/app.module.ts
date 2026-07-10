import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { PrismaModule } from "./prisma/prisma.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { CommonModule } from "./common/common.module.js";
import { ProjectsModule } from "./projects/projects.module.js";
import { InvitesModule } from "./invites/invites.module.js";
import { ElementsModule } from "./elements/elements.module.js";
import { InfraModule } from "./infra/infra.module.js";
import { AgentsModule } from "./agents/agents.module.js";
import { TasksModule } from "./tasks/tasks.module.js";
import { CheckpointsModule } from "./checkpoints/checkpoints.module.js";
import { TimelineModule } from "./timeline/timeline.module.js";
import { TokensModule } from "./tokens/tokens.module.js";
import { WebhooksModule } from "./webhooks/webhooks.module.js";
import { InternalModule } from "./internal/internal.module.js";
import { OrgsModule } from "./orgs/orgs.module.js";
import { AdminModule } from "./admin/admin.module.js";
import { HealthController } from "./health.controller.js";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Rate limiting. The global limit is a generous backstop only — the canvas
    // bursts many element writes during a drag/resize, so a tight global cap
    // would break normal editing; the real abuse surfaces (invites, tokens,
    // invite-accept) carry their own strict @Throttle overrides. Storage is
    // per-instance (in-memory): on multi-instance Cloud Run this limits per
    // instance, not globally — swap in a shared store (e.g. Redis) to make the
    // caps cluster-wide.
    ThrottlerModule.forRoot([
      { name: "default", ttl: 60_000, limit: 600 },
    ]),
    PrismaModule,
    CommonModule,
    AuthModule, // registers the global Clerk guard
    ProjectsModule,
    InvitesModule,
    ElementsModule,
    InfraModule,
    AgentsModule,
    TasksModule,
    CheckpointsModule,
    TimelineModule,
    TokensModule,
    WebhooksModule,
    InternalModule,
    OrgsModule,
    AdminModule,
  ],
  controllers: [HealthController],
  // ThrottlerGuard runs on every route (registered globally). Sensitive routes
  // narrow it further with @Throttle; machine-to-machine routes (health probe,
  // Clerk webhook, Cloud Tasks jobs) opt out with @SkipThrottle since they carry
  // their own auth and are hit at their own cadence.
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
