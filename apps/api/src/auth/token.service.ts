import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";

@Injectable()
export class TokenService {
  createOpaqueToken(byteLength = 48): string {
    return randomBytes(byteLength).toString("base64url");
  }

  hashToken(token: string): string {
    return createHash("sha256").update(token).digest("base64url");
  }
}
