import { Module } from "@nestjs/common";
import { TimelineModule } from "../timeline/timeline.module.js";
import { InfraController } from "./infra.controller.js";
import { InfraService } from "./infra.service.js";

@Module({
  imports: [TimelineModule],
  controllers: [InfraController],
  providers: [InfraService],
})
export class InfraModule {}
