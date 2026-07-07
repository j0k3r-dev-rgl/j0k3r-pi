/**
 * TypeScript fixture for reverse_function_call_tree examples.
 *
 * helper is called from two independent branches, and each branch is called
 * recursively from higher-level entry points so reverse caller expansion can be
 * inspected manually.
 */

export function helper(): void {}

export function runService(): void {
  helper();
}

export function warmupService(): void {
  helper();
}

export function handleRequest(): void {
  runService();
}

export function warmupRoute(): void {
  warmupService();
}

export function main(): void {
  handleRequest();
}

export function bootstrap(): void {
  warmupRoute();
}

export function startHttp(): void {
  main();
}

export function startWarmup(): void {
  bootstrap();
}
