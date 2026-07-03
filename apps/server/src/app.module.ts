import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
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
import { OrgsModule } from "./orgs/orgs.module.js";
import { AdminModule } from "./admin/admin.module.js";
import { HealthController } from "./health.controller.js";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
    OrgsModule,
    AdminModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
