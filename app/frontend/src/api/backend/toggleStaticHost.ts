import * as api from "./base";

export async function toggleStaticHost(id: number, enabled: boolean): Promise<boolean> {
	return await api.post({
		url: `/nginx/static-hosts/${id}/${enabled ? "enable" : "disable"}`,
	});
}
