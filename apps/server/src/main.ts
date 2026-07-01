import "reflect-metadata";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import { AppModule } from "./app.module.js";

// Prisma BigInt columns (e.g. VersionEntry.seq/ts) aren't JSON-serializable by
// default. We never return them directly, but guard against accidental leaks.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function bootstrap(): Promise<void> {
  // rawBody: keep the unparsed request buffer around so the Clerk webhook route
  // can verify its Svix signature over the exact bytes (a re-serialized JSON body
  // would not match the signature).
  const app = await NestFactory.create(AppModule, {
    bufferLogs: false,
    rawBody: true,
  });

  app.use(helmet());
  app.enableShutdownHooks();

  const origins = process.env.CORS_ORIGINS?.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  // Fail closed: in production we must have an explicit allow-list. Reflecting
  // every origin with credentials:true is a deploy-misconfig we refuse to boot
  // into rather than run silently.
  const isProd = process.env.NODE_ENV === "production" || process.env.NODE_ENV === "staging";
  if (isProd && !origins?.length) {
    throw new Error(
      "CORS_ORIGINS must be set in production — refusing to reflect all origins.",
    );
  }
  app.enableCors({
    // Dev convenience only: reflect the caller's origin. Prod always uses the
    // explicit list above.
    origin: origins?.length ? origins : true,
    credentials: true,
    allowedHeaders: ["authorization", "content-type"],
  });

  // Defense in depth: anything not explicitly validated by a ZodBody pipe still
  // gets stripped of unknown properties.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = Number(process.env.PORT ?? 8080);
  await app.listen(port, "0.0.0.0");
  new Logger("Bootstrap").log(`Forward server listening on :${port}`);
}

void bootstrap();
