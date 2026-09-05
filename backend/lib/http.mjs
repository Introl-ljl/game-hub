export function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      ...headers
    }
  });
}

export function errorResponse(error) {
  if (error instanceof HttpError) return json({ error: error.message, code: error.code }, error.status);
  console.error('Unhandled API error', error);
  return json({ error: '服务器暂时不可用', code: 'INTERNAL_ERROR' }, 500);
}

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'INVALID_JSON', '请求内容不是有效 JSON');
  }
}

export function assertSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return;
  const allowed = new Set([
    new URL(request.url).origin,
    ...String(process.env.PUBLIC_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean)
  ]);
  if (!allowed.has(origin)) throw new HttpError(403, 'INVALID_ORIGIN', '请求来源无效');
}
