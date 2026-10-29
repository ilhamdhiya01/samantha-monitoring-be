import { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { DockerService } from '../src/modules/docker/docker.service';
import { HealthController } from '../src/modules/health/health.controller';

// Envelope respons ({ data, message }) dan 503 saat dependensi mati, tanpa
// DB/Docker sungguhan.
describe('GET /api/v1/health (e2e)', () => {
  let app: INestApplication<App>;
  const prisma = { $queryRaw: jest.fn() };
  const docker = { ping: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: DockerService, useValue: docker },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns ok inside the envelope', async () => {
    prisma.$queryRaw.mockResolvedValue([1]);
    docker.ping.mockResolvedValue(true);

    const response = await request(app.getHttpServer()).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: { status: 'ok', db: true, docker: true },
      message: 'Health checked',
    });
  });

  it('returns 503 when Docker is unreachable', async () => {
    prisma.$queryRaw.mockResolvedValue([1]);
    docker.ping.mockResolvedValue(false);

    const response = await request(app.getHttpServer()).get('/api/v1/health');
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      data: { status: 'down', docker: false },
    });
  });
});
