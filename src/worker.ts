import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { WorkerModule } from "./workers/worker.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true
  });
  app.enableShutdownHooks();
}

void bootstrap();
