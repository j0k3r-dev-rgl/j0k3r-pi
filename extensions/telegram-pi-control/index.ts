export default function telegramPiControlExtension(_pi: any): void {
  // The Telegram gateway is intentionally started only through
  // `npm run gateway:start`. Keeping this factory side-effect free lets Pi
  // auto-discover the package without starting polling or reading secrets.
}
