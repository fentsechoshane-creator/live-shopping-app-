import { share } from "../_share.ts";
export const onRequestGet = (ctx: any) => share("i", ctx);
