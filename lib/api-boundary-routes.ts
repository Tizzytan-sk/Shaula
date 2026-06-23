export const PUBLIC_API_ROUTE_FILES = [
  "app/api/health/route.ts",
  "app/api/remote/ping/route.ts",
  "app/api/remote/pair/info/route.ts",
  "app/api/remote/pair/complete/route.ts",
  "app/api/auth/login/[provider]/route.ts",
] as const;

export function normalizeApiRouteFile(file: string): string {
  return file.replace(/\\/g, "/");
}

export function isPublicApiRouteFile(file: string): boolean {
  const normalized = normalizeApiRouteFile(file);
  return (PUBLIC_API_ROUTE_FILES as readonly string[]).includes(normalized);
}
