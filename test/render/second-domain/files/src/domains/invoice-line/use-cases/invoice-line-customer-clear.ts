import type { Actor } from "@n8io/baseline-authn";
import type { Inbox } from "@n8io/baseline-queue";
import { ok, type Result } from "@n8io/baseline-result";
import type { InvoiceLineCustomerClearInput } from "../models/invoice-line.ts";
import type { InvoiceLinePorts } from "../ports.ts";

// Removes a deleted customer from its invoice lines. Called by the customer.deleted consumer
// with its inbox in the input: a repeated event commits nothing and returns ok. Cached invoice lines expire
// on their own; the cache keeps no customer-wide index to clear.
export const invoiceLineCustomerClear =
	({
		invoiceLineTransaction,
	}: Pick<InvoiceLinePorts, "invoiceLineTransaction">) =>
	async (
		_actor: Actor,
		{ inbox, ...input }: InvoiceLineCustomerClearInput & { inbox: Inbox },
	): Promise<Result<void, never>> =>
		invoiceLineTransaction(async ({ invoiceLineRepository }) => {
			await invoiceLineRepository.customerClear(input.customerId);
			return ok(undefined);
		}, inbox);
