import { Global, Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import configuration from '../config/configuration';
import { validationSchema } from '../config/validation.schema';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { ResponseInterceptor } from './interceptors/response.interceptor';
import { PrismaService } from './prisma/prisma.service';

@Global()
@Module({
  imports: [
    WinstonModule.forRoot({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
      ),
      transports: [
        // LOG_LEVEL dibaca langsung dari env: modul ini yang menyediakan
        // ConfigModule, jadi ConfigService belum ada di titik ini.
        new winston.transports.Console({
          level: process.env.LOG_LEVEL ?? 'info',
        }),
      ],
    }),
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema,
      load: [configuration],
    }),
    ScheduleModule.forRoot(),
  ],
  providers: [
    PrismaService,
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, transform: true }),
    },
  ],
  exports: [PrismaService, WinstonModule, ConfigModule],
})
export class CommonModule {}
