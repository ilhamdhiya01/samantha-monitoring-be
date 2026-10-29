// @nestjs/schedule v12 adalah ESM murni. Di tes, dekorator jadwal tidak
// melakukan apa-apa — method dipanggil langsung oleh spec.
const noopDecorator = (): MethodDecorator => () => undefined;

export const Interval = noopDecorator;
export const Cron = noopDecorator;
export const Timeout = noopDecorator;
export class ScheduleModule {
  static forRoot() {
    return { module: ScheduleModule };
  }
}
