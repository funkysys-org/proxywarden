import * as api from "./base";
import type { HostExpansion } from "./expansions";
import type { StaticHost } from "./models";

export async function getStaticHosts(expand?: HostExpansion[], params = {}): Promise<StaticHost[]> {
	return await api.get({
		url: "/nginx/static-hosts",
		params: {
			expand: expand?.join(","),
			...params,
		},
	});
}
