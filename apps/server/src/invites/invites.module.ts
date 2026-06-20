import { Module } from "@nestjs/common";
import { InvitesController } from "./invites.controller.js";
import { InvitesService } from "./invites.service.js";

@Module({
  controllers: [InvitesController],
  providers: [InvitesService],
})
export class InvitesModule {}
