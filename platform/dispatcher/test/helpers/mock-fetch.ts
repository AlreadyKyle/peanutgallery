// A fetch double that routes by method and URL and records every call.
export interface FetchCall {
  method: string;
  url: string;
  body: unknown;
}

export type Reply = { status: number; json?: unknown; text?: string };
export type Route = (method: string, url: string, body: unknown) => Reply | undefined;

export function mockFetch(route: Route): { fetchFn: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ method, url, body });
    const reply = route(method, url, body);
    if (!reply) throw new Error(`no route for ${method} ${url}`);
    const text = reply.text ?? (reply.json === undefined ? '' : JSON.stringify(reply.json));
    return new Response(text, { status: reply.status });
  }) as typeof fetch;
  return { fetchFn, calls };
}
