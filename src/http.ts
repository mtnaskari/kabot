export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, string>,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function json(status: number, body: unknown, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function errorResponse(error: unknown, headers: HeadersInit = {}): Response {
  if (error instanceof HttpError) {
    const extra: Record<string, string> = error.retryAfter ? { "retry-after": String(error.retryAfter) } : {};
    return json(
      error.status,
      { ok: false, error: { code: error.code, message: error.message, ...(error.details ? { fields: error.details } : {}) } },
      { ...headers, ...extra },
    );
  }
  console.error("unhandled_error", error instanceof Error ? error.stack ?? error.message : String(error));
  return json(500, { ok: false, error: { code: "internal", message: "Something went wrong." } }, headers);
}

/** Reads a JSON object body, refusing anything larger than maxBytes. */
export async function readJson(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new HttpError(413, "too_large", "Request body is too large.");
  if (!request.body) throw new HttpError(400, "bad_request", "A JSON body is required.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, "too_large", "Request body is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "bad_request", "Body must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "bad_request", "Body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "";
}

export function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}
