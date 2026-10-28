import { createDemoApi } from "./demoApi";
import { createSupabaseApi } from "./supabaseApi";
import type { Api } from "./types";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Live when Supabase keys are set, otherwise the in-browser demo. */
export const api: Api = url && key ? createSupabaseApi(url, key) : createDemoApi();
export const authMethod = (import.meta.env.VITE_AUTH_METHOD as string | undefined) === "phone" ? "phone" : "email";
export * from "./types";
