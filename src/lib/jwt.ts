import { Effect } from "effect";
import type { JWTHeader, JWTPayload } from "./types.ts";

const base64UrlEncode = (str: string): string =>
  Buffer.from(str, "utf-8").toString("base64url");

const base64UrlDecode = (str: string): string =>
  Buffer.from(str, "base64url").toString("utf-8");

const constantTimeCompare = (a: string, b: string): boolean => {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    // biome-ignore lint: constant-time comparison requires bitwise operations
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return diff === 0;
};

const getJWTSecret = (): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    const secret = process.env["JWT_SECRET"];
    if (!secret) {
      yield* Effect.fail(
        new Error("JWT_SECRET environment variable is not set")
      );
    }
    return secret as string;
  });

export const sign = (
  payload: Omit<JWTPayload, "iat" | "exp">,
  expiresInSeconds: number = 7 * 24 * 60 * 60
): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    const secret = yield* getJWTSecret();

    const now = Math.floor(Date.now() / 1000);
    const fullPayload: JWTPayload = {
      ...payload,
      iat: now,
      exp: now + expiresInSeconds,
    };

    const header: JWTHeader = {
      alg: "HS256",
      typ: "JWT",
    };

    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
    const unsignedToken = `${encodedHeader}.${encodedPayload}`;

    const hasher = new Bun.CryptoHasher("sha256", secret);
    hasher.update(unsignedToken);
    const signature = hasher.digest("base64url");

    return `${unsignedToken}.${signature}`;
  });

export const verify = (token: string): Effect.Effect<JWTPayload, Error> =>
  Effect.gen(function* () {
    const secret = yield* getJWTSecret();

    const parts = token.split(".");
    if (parts.length !== 3) {
      yield* Effect.fail(new Error("Invalid token format"));
    }

    const encodedHeader = parts[0];
    const encodedPayload = parts[1];
    const signature = parts[2];

    const hasAllParts = encodedHeader && encodedPayload && signature;
    if (!hasAllParts) {
      yield* Effect.fail(new Error("Invalid token format"));
    }

    const header: JWTHeader = yield* Effect.try({
      try: () =>
        JSON.parse(base64UrlDecode(encodedHeader as string)) as JWTHeader,
      catch: () => new Error("Invalid token header"),
    });

    if (header.alg !== "HS256") {
      yield* Effect.fail(new Error("Unsupported algorithm"));
    }

    if (header.typ !== "JWT") {
      yield* Effect.fail(new Error("Invalid token type"));
    }

    const unsignedToken = `${encodedHeader}.${encodedPayload}`;

    const hasher = new Bun.CryptoHasher("sha256", secret);
    hasher.update(unsignedToken);
    const expectedSignature = hasher.digest("base64url");

    if (!constantTimeCompare(signature as string, expectedSignature)) {
      yield* Effect.fail(new Error("Invalid token signature"));
    }

    const payload: JWTPayload = yield* Effect.try({
      try: () =>
        JSON.parse(base64UrlDecode(encodedPayload as string)) as JWTPayload,
      catch: () => new Error("Invalid token payload"),
    });

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      yield* Effect.fail(new Error("Token expired"));
    }

    return payload;
  });
