import { useQuery } from "@tanstack/react-query";
import { type StaticHost, getStaticHosts, type HostExpansion } from "src/api/backend";

const fetchStaticHosts = (expand?: HostExpansion[]) => {
	return getStaticHosts(expand);
};

const useStaticHosts = (expand?: HostExpansion[], options = {}) => {
	return useQuery<StaticHost[], Error>({
		queryKey: ["static-hosts", { expand }],
		queryFn: () => fetchStaticHosts(expand),
		staleTime: 60 * 1000,
		...options,
	});
};

export { fetchStaticHosts, useStaticHosts };
