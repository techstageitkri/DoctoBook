import { Module } from "@nestjs/common";
import { PublicMarketplaceController } from "./public-marketplace.controller.js";
import { PublicMarketplaceService } from "./public-marketplace.service.js";

@Module({
  controllers: [PublicMarketplaceController],
  providers: [PublicMarketplaceService],
  exports: [PublicMarketplaceService]
})
export class PublicMarketplaceModule {}
