const HOP_BY_HOP_HEADERS = ['connection', 'content-length', 'host', 'transfer-encoding', 'accept-encoding', 'cf-connecting-ip', 'cf-ray'];

export async function proxy(request, backendPath = null) {
  try {
    const origin = process.env.BACKEND_ORIGIN;
    const secret = process.env.BACKEND_PROXY_SECRET;
    if (!origin || !secret) throw new Error('Backend proxy environment is not configured');
    const sourceUrl = new URL(request.url);
    const targetUrl = new URL(backendPath || `${sourceUrl.pathname}${sourceUrl.search}`, origin);
    const headers = new Headers(request.headers);
    for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
    headers.set('x-gamehub-proxy-secret', secret);
    headers.set('x-gamehub-client-ip', request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown');
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
    const backend = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(15000)
    });
    const responseHeaders = new Headers(backend.headers);
    responseHeaders.delete('content-length');
    responseHeaders.delete('content-encoding');
    responseHeaders.set('Cache-Control', 'no-store');
    return new Response(backend.body, { status: backend.status, headers: responseHeaders });
  } catch (error) {
    console.error('Backend proxy failed', error);
    return Response.json({ error: '后端服务暂时不可用', code: 'BACKEND_UNAVAILABLE' }, { status: 502 });
  }
}
