import { IconArrowsCross, IconBolt, IconBoltOff, IconDisc, IconFileText } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import { HasPermission } from "src/components";
import { MetricsDashboard } from "src/components/MetricsDashboard";
import { useCertificates, useHostReport } from "src/hooks";
import { T } from "src/locale";
import { ADMIN, DEAD_HOSTS, PROXY_HOSTS, REDIRECTION_HOSTS, STATIC_HOSTS, STREAMS, VIEW } from "src/modules/Permissions";

const Dashboard = () => {
	const { data: hostReport } = useHostReport();
	const { data: certificates, error: certsError } = useCertificates();
	const navigate = useNavigate();

	// Certificate expiry triage — only what NEEDS the operator:
	//   expired certs (ANY provider: a dead LE cert means its renewal broke)
	//   non-LE certs expiring within 60 days (LE renews itself = noise here)
	// A healthy fleet shows no card at all.
	const certRows = (certificates || [])
		.map((c) => {
			const days = Math.ceil((new Date(c.expiresOn).getTime() - Date.now()) / 86400000);
			const severity = days <= 7 ? "danger" : days <= 60 ? "warning" : "success";
			return { id: c.id, niceName: c.niceName, provider: c.provider, days, severity };
		})
		.filter((c) => c.days <= 0 || (c.provider !== "letsencrypt" && c.days <= 60))
		.sort((a, b) => a.days - b.days)
		.slice(0, 6);

	return (
		<div>
			<h2>
				<T id="dashboard" />
			</h2>
			<div className="row row-deck row-cards">
				<div className="col-12 my-4">
					<div className="row row-cards row-cols-2 row-cols-md-5">
						<HasPermission section={PROXY_HOSTS} permission={VIEW} hideError>
							<div className="col">
								<a
									href="/nginx/proxy"
									className="card card-sm card-link card-link-pop"
									onClick={(e) => {
										e.preventDefault();
										navigate("/nginx/proxy");
									}}
								>
									<div className="card-body">
										<div className="row align-items-center">
											<div className="col-auto">
												<span className="bg-green text-white avatar">
													<IconBolt />
												</span>
											</div>
											<div className="col">
												<div className="font-weight-medium">
													<T id="proxy-hosts.count" data={{ count: hostReport?.proxy }} />
												</div>
											</div>
										</div>
									</div>
								</a>
							</div>
						</HasPermission>
						<HasPermission section={REDIRECTION_HOSTS} permission={VIEW} hideError>
							<div className="col">
								<a
									href="/nginx/redirection"
									className="card card-sm card-link card-link-pop"
									onClick={(e) => {
										e.preventDefault();
										navigate("/nginx/redirection");
									}}
								>
									<div className="card-body">
										<div className="row align-items-center">
											<div className="col-auto">
												<span className="bg-yellow text-white avatar">
													<IconArrowsCross />
												</span>
											</div>
											<div className="col">
												<T
													id="redirection-hosts.count"
													data={{ count: hostReport?.redirection }}
												/>
											</div>
										</div>
									</div>
								</a>
							</div>
						</HasPermission>
						<HasPermission section={STREAMS} permission={VIEW} hideError>
							<div className="col">
								<a
									href="/nginx/stream"
									className="card card-sm card-link card-link-pop"
									onClick={(e) => {
										e.preventDefault();
										navigate("/nginx/stream");
									}}
								>
									<div className="card-body">
										<div className="row align-items-center">
											<div className="col-auto">
												<span className="bg-blue text-white avatar">
													<IconDisc />
												</span>
											</div>
											<div className="col">
												<T id="streams.count" data={{ count: hostReport?.stream }} />
											</div>
										</div>
									</div>
								</a>
							</div>
						</HasPermission>
						<HasPermission section={DEAD_HOSTS} permission={VIEW} hideError>
							<div className="col">
								<a
									href="/nginx/404"
									className="card card-sm card-link card-link-pop"
									onClick={(e) => {
										e.preventDefault();
										navigate("/nginx/404");
									}}
								>
									<div className="card-body">
										<div className="row align-items-center">
											<div className="col-auto">
												<span className="bg-red text-white avatar">
													<IconBoltOff />
												</span>
											</div>
											<div className="col">
												<T id="dead-hosts.count" data={{ count: hostReport?.dead }} />
											</div>
										</div>
									</div>
								</a>
							</div>
						</HasPermission>
						<HasPermission section={STATIC_HOSTS} permission={VIEW} hideError>
							<div className="col">
								<a
									href="/nginx/static"
									className="card card-sm card-link card-link-pop"
									onClick={(e) => {
										e.preventDefault();
										navigate("/nginx/static");
									}}
								>
									<div className="card-body">
										<div className="row align-items-center">
											<div className="col-auto">
												<span className="bg-teal text-white avatar">
													<IconFileText />
												</span>
											</div>
											<div className="col">
												<T id="static-hosts.count" data={{ count: hostReport?.static }} />
											</div>
										</div>
									</div>
								</a>
							</div>
						</HasPermission>
						</div>
				</div>
			</div>

			{!certsError && certRows.length > 0 && (
				<div className="card mt-4">
					<div className="card-status-top bg-teal" />
					<div className="card-header">
						<h3 className="card-title">
							<T id="certificates" />
						</h3>
						<div className="card-subtitle text-secondary">
							<T id="dashboard.certificates-hint" />
						</div>
					</div>
					<div className="card-body">
						<ul className="list-group list-group-flush">
							{certRows.map((c) => (
								<li key={c.id} className="list-group-item d-flex align-items-center">
									<span className="me-auto">{c.niceName}</span>
									<span className={`badge bg-${c.severity}`}>
										{c.days <= 0 ? (
											<T id="dashboard.cert-expired" />
										) : (
											<T id="dashboard.cert-expiry" data={{ count: c.days }} />
										)}
									</span>
								</li>
							))}
						</ul>
					</div>
				</div>
			)}

			{/* Metrics + WAF activity: admin-only, was the standalone /metrics page */}
			<HasPermission section={ADMIN} permission={VIEW} hideError>
				<MetricsDashboard />
			</HasPermission>
		</div>
	);
};

export default Dashboard;
