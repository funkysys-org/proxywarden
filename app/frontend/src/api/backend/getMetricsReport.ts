import * as api from "./base";
import type { MetricsReport } from "./models";

export async function getMetricsReport(params = {}): Promise<MetricsReport> {
	return await api.get({
		url: "/reports/metrics",
		params: {
			...params,
		},
	});
}
