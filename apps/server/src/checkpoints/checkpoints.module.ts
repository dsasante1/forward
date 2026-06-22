import { Module } from "@nestjs/common";
import { CheckpointsController } from "./checkpoints.controller.js";
import { CheckpointsService } from "./checkpoints.service.js";

@Module({
  controllers: [CheckpointsController],
  providers: [CheckpointsService],
})
export class CheckpointsModule {}
