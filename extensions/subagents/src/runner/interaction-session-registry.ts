const SUBAGENT_INTERACTION_SESSION_REGISTRY_KEY = Symbol.for('pi.subagents.interactionSessions');

type InteractionRegistry = Map<any, any>;

export function getInteractionSessionRegistry(): InteractionRegistry {
  const globalRecord = globalThis as typeof globalThis & { [key: symbol]: InteractionRegistry | undefined };
  globalRecord[SUBAGENT_INTERACTION_SESSION_REGISTRY_KEY] ??= new Map();
  return globalRecord[SUBAGENT_INTERACTION_SESSION_REGISTRY_KEY]!;
}
