import * as api from "./base";
import type { WafReport } from "./models";

export async function getWafReport(): Promise<WafReport> {
	return await api.get({
		url: "/waf/report",
	});
}
