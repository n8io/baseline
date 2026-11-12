import { OpenAPIHono } from "@hono/zod-openapi";
import { httpValidationHook } from "./http-validation-hook.ts";

/** A router whose request validation answers with `httpValidationHook`'s 400 problem body. */
export const httpRouterCreate = (): OpenAPIHono =>
	new OpenAPIHono({ defaultHook: httpValidationHook });
