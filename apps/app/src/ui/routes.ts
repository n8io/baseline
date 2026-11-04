import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
	// domain-create: domains-start
	index("routes/home.tsx"),
	// domain-create: domains-end
	route("foos", "routes/foo-list.tsx"),
	route("foos/:fooId", "routes/foo-detail.tsx"),
	// domain-create: routes
] satisfies RouteConfig;
