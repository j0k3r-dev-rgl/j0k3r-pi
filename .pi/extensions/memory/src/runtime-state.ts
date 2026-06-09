let currentMemorySessionId: string | undefined;

export function setCurrentMemorySessionId(id: string | undefined): void {
  currentMemorySessionId = id;
}

export function getCurrentMemorySessionId(): string | undefined {
  return currentMemorySessionId;
}
