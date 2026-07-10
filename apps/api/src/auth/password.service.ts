import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions
} from "node:crypto";
import { promisify } from "node:util";
import { Injectable } from "@nestjs/common";

const scrypt = promisify(scryptCallback);
const keyLength = 64;

function scryptWithOptions(
  password: string,
  salt: string,
  keyLength: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey);
    });
  });
}

@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16).toString("base64url");
    const derivedKey = (await scrypt(password, salt, keyLength)) as Buffer;
    return `scrypt:v1:16384:8:1:${salt}:${derivedKey.toString("base64url")}`;
  }

  async verify(password: string, passwordHash: string | null): Promise<boolean> {
    if (!passwordHash) {
      return false;
    }

    const parts = passwordHash.split(":");

    if (parts.length !== 7 || parts[0] !== "scrypt" || parts[1] !== "v1") {
      return false;
    }

    const cost = parts[2];
    const blockSize = parts[3];
    const parallelization = parts[4];
    const salt = parts[5];
    const encodedHash = parts[6];

    if (!cost || !blockSize || !parallelization || !salt || !encodedHash) {
      return false;
    }

    const expected = Buffer.from(encodedHash, "base64url");
    const actual = await scryptWithOptions(password, salt, expected.length, {
      N: Number(cost),
      r: Number(blockSize),
      p: Number(parallelization)
    });

    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
