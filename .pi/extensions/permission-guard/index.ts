import { registerPermissionGuardRuntime, type RuntimePiLike } from './src/runtime.js';

export default function permissionGuardExtension(pi: RuntimePiLike): void {
  registerPermissionGuardRuntime(pi);
}
