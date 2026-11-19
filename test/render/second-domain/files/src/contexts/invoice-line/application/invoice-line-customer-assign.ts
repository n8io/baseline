import type { Actor } from "@n8io/baseline-authn";
import { err, type Result } from "@n8io/baseline-result";
import { telemetrySpanAttributesSet } from "@n8io/baseline-telemetry/span";
import {
	type InvoiceLineForbiddenError,
	type InvoiceLineNameTakenError,
	InvoiceLineNotFoundError,
} from "../domain/errors.ts";
import {
	invoiceLineCustomerAssign as customerAssignTransition,
	type InvoiceLine,
	type InvoiceLineCustomerAssignInput,
} from "../domain/invoice-line.ts";
import type { InvoiceLinePorts } from "./ports.ts";

// Bills an invoice line to a customer the customer domain knows, read through the bridge
// before the transaction opens. An unknown customer answers not found, like the invoice line.
// A customer deleted between the read and the commit is accepted: the customer.deleted
// Consumer clears it.
export const invoiceLineCustomerAssign =
	(ports: InvoiceLinePorts) =>
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
		if (!(await ports.invoiceLineCustomerReader.get(input.customerId))) {
			return err(new InvoiceLineNotFoundError(input.invoiceLineId));
		}
		const result = await ports.invoiceLineTransaction<
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
			const assigned = customerAssignTransition(invoiceLine, {
				actor,
				customerId: input.customerId,
				now: ports.invoiceLineClock.now(),
			});
			return assigned.ok
				? invoiceLineRepository.update(assigned.value)
				: assigned;
		});
		return result;
	};
