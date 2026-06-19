export function shouldProceedWithDangerousAction(message: string, confirmImpl: ((message?: string) => boolean) | undefined = globalThis.confirm): boolean {
  if (typeof confirmImpl !== "function") {
    return true;
  }
  return confirmImpl(message);
}
