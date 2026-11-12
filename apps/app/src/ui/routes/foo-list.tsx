import { authnPageActorRequire } from "@n8io/baseline-authn/react-router";
import { data, Form, Link, redirect, useNavigation } from "react-router";
import { z } from "zod";
import { FooCreateInput, FooListInput } from "#domains/foo/index.ts";
import { Button } from "#ui/components/button.tsx";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "#ui/components/card.tsx";
import { Input } from "#ui/components/input.tsx";
import { Label } from "#ui/components/label.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#ui/components/table.tsx";
import { fooUseCasesContext } from "#ui/context.ts";
import type { Route } from "./+types/foo-list.ts";

export const loader = async (args: Route.LoaderArgs) => {
	const actor = authnPageActorRequire(args);
	const cursor = new URL(args.request.url).searchParams.get("cursor");
	const input = FooListInput.parse(cursor === null ? {} : { cursor });
	const result = await args.context
		.get(fooUseCasesContext)
		.fooList(actor, input);
	if (!result.ok) {
		throw result.error;
	}
	return { items: result.value.items, nextCursor: result.value.nextCursor };
};

export const action = async (args: Route.ActionArgs) => {
	const actor = authnPageActorRequire(args);
	const formData = await args.request.formData();
	const name = String(formData.get("name") ?? "");
	const values = { name };
	const parsed = FooCreateInput.safeParse({ name });
	if (!parsed.success) {
		return data(
			{ errors: z.flattenError(parsed.error).fieldErrors, values },
			{ status: 400 },
		);
	}
	const result = await args.context
		.get(fooUseCasesContext)
		.fooCreate(actor, parsed.data);
	if (!result.ok) {
		if (result.error.type === "FooNameTaken") {
			return data(
				{ errors: { name: [result.error.message] }, values },
				{ status: 409 },
			);
		}
		// An error this page does not handle yet goes to handleError as a 500.
		throw result.error;
	}
	return redirect(`/foos/${result.value.id}`);
};

const FooList = ({ actionData, loaderData }: Route.ComponentProps) => {
	const navigation = useNavigation();
	const submitting = navigation.state === "submitting";
	const nameErrors = actionData?.errors.name;
	return (
		<main className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
			<h1 className="text-2xl font-semibold">Foos</h1>
			<Card>
				<CardHeader>
					<CardTitle>New foo</CardTitle>
				</CardHeader>
				<CardContent>
					<Form method="post" className="space-y-3">
						<div className="space-y-2">
							<Label htmlFor="name">Name</Label>
							<Input
								aria-describedby={nameErrors ? "name-error" : undefined}
								aria-invalid={nameErrors ? true : undefined}
								defaultValue={actionData?.values.name ?? ""}
								id="name"
								name="name"
								required
							/>
							{nameErrors ? (
								<p className="text-sm text-destructive" id="name-error">
									{nameErrors.join(" ")}
								</p>
							) : null}
						</div>
						<Button disabled={submitting} type="submit">
							{submitting ? "Creating…" : "Create"}
						</Button>
					</Form>
				</CardContent>
			</Card>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Name</TableHead>
						<TableHead>Created</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{loaderData.items.length === 0 ? (
						<TableRow>
							<TableCell className="text-muted-foreground" colSpan={2}>
								No foos yet.
							</TableCell>
						</TableRow>
					) : (
						loaderData.items.map((foo) => (
							<TableRow key={foo.id}>
								<TableCell>
									<Link className="underline" to={`/foos/${foo.id}`}>
										{foo.name}
									</Link>
								</TableCell>
								<TableCell>
									{foo.createdAt.toISOString().slice(0, 10)}
								</TableCell>
							</TableRow>
						))
					)}
				</TableBody>
			</Table>
			{loaderData.nextCursor ? (
				<Link
					className="underline"
					to={`?cursor=${encodeURIComponent(loaderData.nextCursor)}`}
				>
					Next page
				</Link>
			) : null}
		</main>
	);
};

export default FooList;
