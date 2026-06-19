export async function resolve(specifier, context, defaultResolve) {
  if (specifier.startsWith("@/")) {
    const withExtension = /\.[a-z]+$/i.test(specifier) ? specifier : `${specifier}.ts`;
    const url = new URL(`../src/${withExtension.slice(2)}`, import.meta.url);
    return defaultResolve(url.href, context, defaultResolve);
  }

  return defaultResolve(specifier, context, defaultResolve);
}
