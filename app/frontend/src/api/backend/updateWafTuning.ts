import * as api from "./base";
import type { WafTuning } from "./models";

export async function updateWafTuning(item: WafTuning): Promise<WafTuning> {
	return await api.put({
		url: "/waf/tuning",
		data: item,
	});
}
