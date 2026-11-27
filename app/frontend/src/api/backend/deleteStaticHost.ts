import * as api from "./base";

export async function deleteStaticHost(id: number): Promise<boolean> {
	return await api.del({
		url: `/nginx/static-hosts/${id}`,
	});
}
