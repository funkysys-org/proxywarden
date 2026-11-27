import { useQuery } from "@tanstack/react-query";
import { getMetricsReport, type MetricsReport } from "src/api/backend";

const fetchMetricsReport = () => getMetricsReport();

const useMetricsReport = (options = {}) => {
	return useQuery<MetricsReport, Error>({
		queryKey: ["metrics-report"],
		queryFn: fetchMetricsReport,
		refetchOnWindowFocus: false,
		retry: 1,
		refetchInterval: 15 * 1000, // 15 seconds — session-sampled series
		staleTime: 14 * 1000,
		...options,
	});
};

export { fetchMetricsReport, useMetricsReport };
