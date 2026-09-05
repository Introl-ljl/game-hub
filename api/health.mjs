import { proxy } from "./_lib/proxy.mjs";

export function GET(request) { return proxy(request, "/healthz"); }
