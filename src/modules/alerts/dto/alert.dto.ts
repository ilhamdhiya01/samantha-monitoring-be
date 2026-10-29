import type { Alert } from '../../../generated/prisma/client';

export type AlertKindDto =
  'container_exited' | 'restart_loop' | 'disk_usage' | 'error_spike';

// Kontrak dengan FE (alert.types.ts) — enum dikirim lowercase.
export interface AlertDto {
  id: string;
  kind: AlertKindDto;
  severity: 'critical' | 'warning';
  title: string;
  description: string;
  container: string | null;
  firedAt: string;
}

export const toAlertDto = (alert: Alert): AlertDto => ({
  id: alert.id,
  kind: alert.kind.toLowerCase() as AlertKindDto,
  severity: alert.severity === 'CRITICAL' ? 'critical' : 'warning',
  title: alert.title,
  description: alert.description,
  container: alert.container,
  firedAt: alert.firedAt.toISOString(),
});
