import { Module } from "@nestjs/common";
import { InternalJobsController } from "./internal-jobs.controller.js";

/**
 * Server-to-server job handlers invoked by Cloud Tasks (CloudTasksService). No
 * providers of its own — EmailService and friends come from the global
 * CommonModule.
 */
@Module({
  controllers: [InternalJobsController],
})
export class InternalModule {}
