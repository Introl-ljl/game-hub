import { proxy } from "./_lib/proxy.mjs";

export const GET = (request) => proxy(request);
export const POST = (request) => proxy(request);
export const DELETE = (request) => proxy(request);
