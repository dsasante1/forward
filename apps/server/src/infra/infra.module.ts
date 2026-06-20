import { Module } from "@nestjs/common";
import { InfraController } from "./infra.controller.js";
import { InfraService } from "./infra.service.js";

@Module({
  controllers: [InfraController],
  providers: [InfraService],
})
export class InfraModule {}
