import { IsString, MaxLength } from 'class-validator';

// Body POST /containers/:name/stop|start. `confirm` harus sama dengan nama
// container (diketik user di dialog konfirmasi). Content-Type JSON dipaksa
// di controller.
export class ContainerActionBodyDto {
  @IsString()
  @MaxLength(128)
  confirm!: string;
}

// Kontrak dengan FE (action.types.ts).
export interface ActionStatusDto {
  enabled: boolean;
  // Kosong kalau aksi tersedia; selain itu alasan untuk tooltip FE.
  disabledReason: string | null;
  protectedProjects: string[];
}

export interface ContainerActionResultDto {
  container: string;
  action: 'stop' | 'start';
}
