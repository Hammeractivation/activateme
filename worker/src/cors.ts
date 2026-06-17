/** Browser origins allowed to call the API from JavaScript (GitHub Pages site). */
export const ALLOWED_BROWSER_ORIGINS = [
  "https://hammeractivation.github.io",
  "http://localhost:8787",
  "http://127.0.0.1:8787",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
  if (origin && ALLOWED_BROWSER_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

/** True when the request comes from the activation website in a browser. */
export function isBrowserOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return !!origin && ALLOWED_BROWSER_ORIGINS.includes(origin);
}
