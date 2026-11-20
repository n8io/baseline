import { OpenAPIHono } from "@hono/zod-openapi";
import { httpValidationHook } from "./http-validation-hook.ts";

/** A router whose failed request validation answers 400 `ValidationFailed` with one JSON Pointer per issue. */
export const httpRouterCreate = (): OpenAPIHono =>
	new OpenAPIHono({ defaultHook: httpValidationHook });
