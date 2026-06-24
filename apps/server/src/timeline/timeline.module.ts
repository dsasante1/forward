import { Module } from "@nestjs/common";
import { TimelineController } from "./timeline.controller.js";
import { TimelineService } from "./timeline.service.js";

/**
 * The unified activity feed. Exports TimelineService so the element + infra
 * modules can record events inside their own write transactions.
 */
@Module({
  controllers: [TimelineController],
  providers: [TimelineService],
  exports: [TimelineService],
})
export class TimelineModule {}
