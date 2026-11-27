import * as api from "./base";
import type { StaticHost } from "./models";

export async function createStaticHost(item: StaticHost): Promise<StaticHost> {
	return await api.post({
		url: "/nginx/static-hosts",
		data: item,
	});
}
