import { Module } from "@nestjs/common";
import { TimelineModule } from "../timeline/timeline.module.js";
import { AgentsController } from "./agents.controller.js";
import { AgentsService } from "./agents.service.js";

@Module({
  imports: [TimelineModule],
  controllers: [AgentsController],
  providers: [AgentsService],
})
export class AgentsModule {}
