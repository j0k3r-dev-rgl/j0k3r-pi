/**
 * JavaScript fixture for reverse_function_call_tree examples.
 */

export function helper() {}

export function runService() {
  helper();
}

export function warmupService() {
  helper();
}

export function handleRequest() {
  runService();
}

export function warmupRoute() {
  warmupService();
}

export function main() {
  handleRequest();
}

export function bootstrap() {
  warmupRoute();
}

export function startHttp() {
  main();
}

export function startWarmup() {
  bootstrap();
}
