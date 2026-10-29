// Subset field event Docker (GET /events, type=container) yang dipakai.
export interface DockerContainerEvent {
  action: string;
  containerId: string;
  name: string;
  image: string;
  exitCode: number | null;
  // milidetik
  time: number;
}

export interface RawDockerEvent {
  Type?: string;
  Action?: string;
  Actor?: { ID?: string; Attributes?: Record<string, string> };
  time?: number;
  timeNano?: number;
}

export const toContainerEvent = (
  raw: RawDockerEvent,
): DockerContainerEvent | null => {
  if (raw.Type !== 'container' || !raw.Action || !raw.Actor?.ID) return null;
  const attributes = raw.Actor.Attributes ?? {};
  // `exec_start: sh -c …` dan sejenisnya — cukup kata pertama.
  const action = raw.Action.split(':')[0].trim();
  const exitCode = attributes.exitCode;
  return {
    action,
    containerId: raw.Actor.ID,
    name: attributes.name ?? raw.Actor.ID.slice(0, 12),
    image: attributes.image ?? '',
    exitCode: exitCode === undefined ? null : Number(exitCode),
    time: raw.timeNano
      ? Math.floor(raw.timeNano / 1e6)
      : (raw.time ?? Date.now() / 1000) * 1000,
  };
};
