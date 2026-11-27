import * as api from "./base";
import type { HostExpansion } from "./expansions";
import type { StaticHost } from "./models";

export async function getStaticHost(id: number, expand?: HostExpansion[], params = {}): Promise<StaticHost> {
	return await api.get({
		url: `/nginx/static-hosts/${id}`,
		params: {
			expand: expand?.join(","),
			...params,
		},
	});
}
