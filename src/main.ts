import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const configService = app.get(ConfigService);

  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));
  app.setGlobalPrefix('api/v1');
  // Dev: FE (Vite :3000) dan BE (:3001) beda origin. Produksi satu origin
  // di belakang Nginx, jadi CORS ini tidak terpakai.
  // credentials: FE mengirim request dengan withCredentials (axios dan
  // EventSource); tanpa Access-Control-Allow-Credentials browser membuang
  // responsnya walau status 200.
  app.enableCors({
    origin: configService.getOrThrow<string>('feUrl'),
    credentials: true,
  });
  // Flush hitungan error & tutup stream Docker saat SIGTERM (docker stop).
  app.enableShutdownHooks();

  await app.listen(configService.get<number>('port') ?? 3001);
}
void bootstrap();
