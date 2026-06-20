import { Module } from "@nestjs/common";
import { ElementsController } from "./elements.controller.js";
import { ElementsService } from "./elements.service.js";

@Module({
  controllers: [ElementsController],
  providers: [ElementsService],
})
export class ElementsModule {}
