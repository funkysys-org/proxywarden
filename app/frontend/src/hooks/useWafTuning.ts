import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getWafTuning, updateWafTuning, type WafTuning } from "src/api/backend";

const useWafTuning = (options = {}) => {
	return useQuery<WafTuning, Error>({
		queryKey: ["waf-tuning"],
		queryFn: () => getWafTuning(),
		staleTime: 30 * 1000, // 30 seconds
		...options,
	});
};

const useSetWafTuning = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (values: WafTuning) => updateWafTuning(values),
		onSuccess: (data: WafTuning) => {
			queryClient.setQueryData(["waf-tuning"], data);
		},
	});
};

export { useSetWafTuning, useWafTuning };
