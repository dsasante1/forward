import { Module } from "@nestjs/common";
import { TimelineModule } from "../timeline/timeline.module.js";
import { ElementsController } from "./elements.controller.js";
import { ElementsService } from "./elements.service.js";

@Module({
  imports: [TimelineModule],
  controllers: [ElementsController],
  providers: [ElementsService],
})
export class ElementsModule {}
