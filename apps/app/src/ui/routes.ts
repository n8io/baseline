import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
	index("routes/home.tsx"),
	route("foos", "routes/foo-list.tsx"),
	route("foos/:fooId", "routes/foo-detail.tsx"),
	// domain-create: routes
] satisfies RouteConfig;
