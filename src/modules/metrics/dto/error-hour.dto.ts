// Kontrak dengan FE (ErrorHour di log.types.ts).
export interface ErrorHourDto {
  // ISO, awal jam.
  hour: string;
  errors: number;
  warnings: number;
}
