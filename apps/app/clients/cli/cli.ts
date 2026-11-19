#!/usr/bin/env node
// The Project's command line tool, named after it: one command per API operation, read from the
// SDK's copy of the OpenAPI document and calling the SDK function with the same operationId.
import { cliCreate } from "@n8io/baseline-cli";
import * as sdk from "app-sdk";
import document from "app-sdk/openapi.json" with { type: "json" };

const { sdkConfigure: _, ...operations } = sdk;

await cliCreate({ document, name: document.info.title, operations }).run(
	process.argv.slice(2),
);
