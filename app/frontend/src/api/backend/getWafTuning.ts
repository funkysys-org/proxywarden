import * as api from "./base";
import type { WafTuning } from "./models";

export async function getWafTuning(): Promise<WafTuning> {
	return await api.get({
		url: "/waf/tuning",
	});
}
