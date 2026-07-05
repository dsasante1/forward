import { Module } from "@nestjs/common";
import { TimelineModule } from "../timeline/timeline.module.js";
import { CheckpointsController } from "./checkpoints.controller.js";
import { CheckpointsService } from "./checkpoints.service.js";

@Module({
  imports: [TimelineModule],
  controllers: [CheckpointsController],
  providers: [CheckpointsService],
})
export class CheckpointsModule {}
