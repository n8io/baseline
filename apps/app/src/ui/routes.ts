import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
	// wiring: contexts-start
	index("routes/home.tsx"),
	// wiring: contexts-end
	route("foos", "routes/foo-list.tsx"),
	route("foos/:fooId", "routes/foo-detail.tsx"),
	// wiring: routes
] satisfies RouteConfig;
