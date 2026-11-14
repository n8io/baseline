import type { Actor } from "@n8io/baseline-authn";
import { err, type Result } from "@n8io/baseline-result";
import { telemetrySpanAttributesSet } from "@n8io/baseline-telemetry/span";
import {
	InvoiceLineForbiddenError,
	type InvoiceLineNameTakenError,
	InvoiceLineNotFoundError,
} from "../invoice-line-errors.ts";
import type {
	InvoiceLine,
	InvoiceLineCustomerAssignInput,
} from "../models/invoice-line.ts";
import type { InvoiceLinePorts } from "../ports.ts";
import { invoiceLineUpdateCan } from "../rules/invoice-line-update-can.ts";

// Bills an invoice line to a customer the customer domain knows, read through the bridge
// before the transaction opens. An unknown customer answers not found, like the invoice line.
// A customer deleted between the read and the commit is accepted: the customer.deleted
// Consumer clears it.
export const invoiceLineCustomerAssign =
	({
		invoiceLineTransaction,
		invoiceLineCache,
		invoiceLineClock,
		invoiceLineCustomerReader,
	}: Pick<
		InvoiceLinePorts,
		| "invoiceLineTransaction"
		| "invoiceLineCache"
		| "invoiceLineClock"
		| "invoiceLineCustomerReader"
	>) =>
	async (
		actor: Actor,
		input: InvoiceLineCustomerAssignInput,
	): Promise<
		Result<
			InvoiceLine,
			| InvoiceLineNotFoundError
			| InvoiceLineNameTakenError
			| InvoiceLineForbiddenError
		>
	> => {
		telemetrySpanAttributesSet({
			"baseline.invoice_line.id": input.invoiceLineId,
		});
		if (!(await invoiceLineCustomerReader.get(input.customerId))) {
			return err(new InvoiceLineNotFoundError(input.invoiceLineId));
		}
		const result = await invoiceLineTransaction<
			InvoiceLine,
			| InvoiceLineNotFoundError
			| InvoiceLineNameTakenError
			| InvoiceLineForbiddenError
		>(async ({ invoiceLineRepository }) => {
			const invoiceLine = await invoiceLineRepository.findByIdForUpdate(
				input.invoiceLineId,
			);
			if (!invoiceLine)
				return err(new InvoiceLineNotFoundError(input.invoiceLineId));
			if (!invoiceLineUpdateCan(invoiceLine, actor)) {
				return err(new InvoiceLineForbiddenError(input.invoiceLineId));
			}
			return invoiceLineRepository.update({
				...invoiceLine,
				customerId: input.customerId,
				updatedAt: invoiceLineClock.now(),
			});
		});
		if (result.ok) await invoiceLineCache.delete(input.invoiceLineId);
		return result;
	};
