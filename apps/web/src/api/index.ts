import { createDemoApi } from "./demoApi";
import { createSupabaseApi } from "./supabaseApi";
import type { Api } from "./types";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Live when Supabase keys are set, otherwise the in-browser demo. The keys are fixed at build time, so the check is
 * written on the env values themselves: the live build then drops the whole demo (sample accounts, code 123456). */
export const api: Api = import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY ? createSupabaseApi(url!, key!) : createDemoApi();
export const authMethod = (import.meta.env.VITE_AUTH_METHOD as string | undefined) === "phone" ? "phone" : "email";
export * from "./types";
