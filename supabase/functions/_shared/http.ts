export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/** A mistake the user can fix. The message is shown in the app as is. */
export class UserError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Wraps a handler with CORS, JSON parsing and error handling. */
export function handler(fn: (req: Request, body: any) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    try {
      const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
      return await fn(req, body);
    } catch (e) {
      if (e instanceof UserError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Something went wrong on our side. Please try again." }, 500);
    }
  };
}

export function env(name: string, fallback?: string): string {
  const v = Deno.env.get(name) ?? fallback;
  if (v === undefined) throw new Error(`Missing environment variable ${name}`);
  return v;
}
