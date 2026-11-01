import type { DeployEvent } from '../../../generated/prisma/client';

// Kontrak dengan FE (deploy.types.ts).
export interface DeployEventDto {
  id: string;
  container: string;
  // Referensi image saat dibuat ("goodenglish-be:test").
  image: string;
  occurredAt: string;
}

export const toDeployEventDto = (event: DeployEvent): DeployEventDto => ({
  id: event.id,
  container: event.container,
  image: event.image,
  occurredAt: event.occurredAt.toISOString(),
});
