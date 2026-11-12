import { authnPageActorRequire } from "@n8io/baseline-authn/react-router";
import { idSchemaCreate } from "@n8io/baseline-id";
import { useLiveUpdates } from "@n8io/baseline-live/client";
import { useState } from "react";
import {
	data,
	Form,
	isRouteErrorResponse,
	Link,
	redirect,
	useNavigation,
} from "react-router";
import { z } from "zod";
import { FooUpdateInput } from "#domains/foo/index.ts";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "#ui/components/alert-dialog.tsx";
import { Button } from "#ui/components/button.tsx";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "#ui/components/card.tsx";
import { Input } from "#ui/components/input.tsx";
import { Label } from "#ui/components/label.tsx";
import { fooUseCasesContext } from "#ui/context.ts";
import type { Route } from "./+types/foo-detail.ts";

const notFound = () =>
	data({ type: "FooNotFound", message: "Foo not found" }, { status: 404 });

const fooIdParse = (params: { fooId?: string | undefined }) => {
	const parsed = idSchemaCreate("foo").safeParse(params.fooId);
	if (!parsed.success) {
		throw notFound();
	}
	return parsed.data;
};

export const loader = async (args: Route.LoaderArgs) => {
	const actor = authnPageActorRequire(args);
	const fooId = fooIdParse(args.params);
	const result = await args.context
		.get(fooUseCasesContext)
		.fooGet(actor, { fooId });
	if (!result.ok) {
		throw data(
			{ type: result.error.type, message: result.error.message },
			{ status: 404 },
		);
	}
	return { foo: result.value };
};

export const action = async (args: Route.ActionArgs) => {
	const actor = authnPageActorRequire(args);
	const fooId = fooIdParse(args.params);
	const useCases = args.context.get(fooUseCasesContext);
	const formData = await args.request.formData();
	const intent = formData.get("intent");
	if (intent === "update") {
		const name = String(formData.get("name") ?? "");
		const values = { name };
		const parsed = FooUpdateInput.safeParse({ fooId, name });
		if (!parsed.success) {
			return data(
				{ errors: z.flattenError(parsed.error).fieldErrors, values },
				{ status: 400 },
			);
		}
		const result = await useCases.fooUpdate(actor, parsed.data);
		if (result.ok) {
			return { ok: true as const };
		}
		const { message, type } = result.error;
		if (result.error.type === "FooNameTaken") {
			return data({ errors: { name: [message] }, values }, { status: 409 });
		}
		if (result.error.type === "FooForbidden") {
			throw data({ type, message }, { status: 403 });
		}
		throw data({ type, message }, { status: 404 });
	}
	if (intent === "delete") {
		const result = await useCases.fooDelete(actor, { fooId });
		if (result.ok) {
			return redirect("/foos");
		}
		const { message, type } = result.error;
		if (result.error.type === "FooForbidden") {
			throw data({ type, message }, { status: 403 });
		}
		throw data({ type, message }, { status: 404 });
	}
	throw data(
		{ type: "ValidationFailed", message: "Unknown intent" },
		{ status: 400 },
	);
};

const FooDetail = ({ actionData, loaderData }: Route.ComponentProps) => {
	const { foo } = loaderData;
	// piece-start: live
	useLiveUpdates("foo", foo.id);
	// piece-end: live
	const [open, setOpen] = useState(false);
	const navigation = useNavigation();
	const pendingIntent =
		navigation.state === "submitting"
			? navigation.formData?.get("intent")
			: undefined;
	const errors =
		actionData && "errors" in actionData ? actionData.errors : undefined;
	const values =
		actionData && "values" in actionData ? actionData.values : undefined;
	const nameErrors = errors?.name;
	return (
		<main className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
			<Link className="underline" to="/foos">
				Back to foos
			</Link>
			<Card>
				<CardHeader>
					<CardTitle>{foo.name}</CardTitle>
					<p className="text-sm text-muted-foreground">
						Created {foo.createdAt.toISOString().slice(0, 10)} · Updated{" "}
						{foo.updatedAt.toISOString().slice(0, 10)}
					</p>
				</CardHeader>
				<CardContent className="space-y-6">
					<Form method="post" className="space-y-3">
						<input name="intent" type="hidden" value="update" />
						<div className="space-y-2">
							<Label htmlFor="name">Name</Label>
							<Input
								aria-describedby={nameErrors ? "name-error" : undefined}
								aria-invalid={nameErrors ? true : undefined}
								defaultValue={values?.name ?? foo.name}
								id="name"
								key={values?.name ?? foo.name}
								name="name"
								required
							/>
							{nameErrors ? (
								<p className="text-sm text-destructive" id="name-error">
									{nameErrors.join(" ")}
								</p>
							) : null}
						</div>
						<Button disabled={pendingIntent !== undefined} type="submit">
							{pendingIntent === "update" ? "Saving…" : "Save"}
						</Button>
					</Form>
					<Form id="foo-delete" method="post">
						<Button
							disabled={pendingIntent !== undefined}
							name="intent"
							onClick={(event) => {
								event.preventDefault();
								setOpen(true);
							}}
							type="submit"
							value="delete"
							variant="destructive"
						>
							{pendingIntent === "delete" ? "Deleting…" : "Delete"}
						</Button>
					</Form>
				</CardContent>
			</Card>
			<AlertDialog open={open} onOpenChange={setOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete this foo?</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently deletes {foo.name}.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction asChild>
							<Button
								form="foo-delete"
								name="intent"
								type="submit"
								value="delete"
							>
								Delete
							</Button>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</main>
	);
};

export default FooDetail;

export const ErrorBoundary = ({ error }: Route.ErrorBoundaryProps) => {
	const status = isRouteErrorResponse(error) ? error.status : undefined;
	return (
		<main className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
			<h1 className="text-2xl font-semibold">
				{status === 404
					? "This foo does not exist."
					: status === 403
						? "You can't change this foo."
						: "Something went wrong."}
			</h1>
			<Link className="underline" to="/foos">
				Back to foos
			</Link>
		</main>
	);
};
