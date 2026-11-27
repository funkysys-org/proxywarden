import * as api from "./base";
import type { StaticHost } from "./models";

export async function updateStaticHost(item: StaticHost): Promise<StaticHost> {
	// Remove readonly fields
	const { id, createdOn: _, modifiedOn: __, ...data } = item;

	return await api.put({
		url: `/nginx/static-hosts/${id}`,
		data: data,
	});
}
