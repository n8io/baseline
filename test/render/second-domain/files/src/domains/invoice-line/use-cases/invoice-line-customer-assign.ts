import type { Actor } from "@n8io/baseline-authn";
import { err, type Result } from "@n8io/baseline-result";
import { trace } from "@opentelemetry/api";
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
import { invoiceLineUpdatable } from "../rules/invoice-line-updatable.ts";

// Bills an invoice line to a customer the customer domain knows, read through the bridge
// before the transaction opens. An unknown customer answers not found, like the invoice line.
export const invoiceLineCustomerAssign =
	({
		invoiceLineTransaction,
		invoiceLineCache,
		invoiceLineCustomerReader,
	}: Pick<
		InvoiceLinePorts,
		"invoiceLineTransaction" | "invoiceLineCache" | "invoiceLineCustomerReader"
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
		trace
			.getActiveSpan()
			?.setAttributes({ "baseline.invoice_line.id": input.invoiceLineId });
		if (!(await invoiceLineCustomerReader.get(input.customerId))) {
			return err(new InvoiceLineNotFoundError(input.invoiceLineId));
		}
		const result = await invoiceLineTransaction<
			InvoiceLine,
			| InvoiceLineNotFoundError
			| InvoiceLineNameTakenError
			| InvoiceLineForbiddenError
		>(async ({ invoiceLineRepository }) => {
			const invoiceLine = await invoiceLineRepository.findById(
				input.invoiceLineId,
			);
			if (!invoiceLine)
				return err(new InvoiceLineNotFoundError(input.invoiceLineId));
			if (!invoiceLineUpdatable(invoiceLine, actor)) {
				return err(new InvoiceLineForbiddenError(input.invoiceLineId));
			}
			return invoiceLineRepository.update({
				...invoiceLine,
				customerId: input.customerId,
				updatedAt: new Date(),
			});
		});
		if (result.ok) await invoiceLineCache.delete(input.invoiceLineId);
		return result;
	};
