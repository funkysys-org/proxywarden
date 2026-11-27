import { useQuery } from "@tanstack/react-query";
import { getWafReport, type WafReport } from "src/api/backend";

const useWafReport = (options = {}) => {
	return useQuery<WafReport, Error>({
		queryKey: ["waf-report"],
		queryFn: () => getWafReport(),
		staleTime: 15 * 1000, // 15 seconds
		...options,
	});
};

export { useWafReport };
