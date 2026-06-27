import { Module } from "@nestjs/common";
import { TokensController } from "./tokens.controller.js";
import { TokensService } from "./tokens.service.js";

/** Exports TokensService so the global ClerkAuthGuard can resolve PAT bearers. */
@Module({
  controllers: [TokensController],
  providers: [TokensService],
  exports: [TokensService],
})
export class TokensModule {}
