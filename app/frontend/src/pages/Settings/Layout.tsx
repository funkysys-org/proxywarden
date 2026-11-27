import { useState } from "react";
import { T } from "src/locale";
import DefaultSite from "./DefaultSite";
import LdapAuth from "./LdapAuth";
import Security from "./Security";
import Waf from "./Waf";

export default function Layout() {
	// Taken from https://preview.tabler.io/settings.html
	// Refer to that when updating this content

	const [active, setActive] = useState("default-site");

	return (
		<div className="card mt-4">
			<div className="card-status-top bg-teal" />
			<div className="card-table">
				<div className="card-header">
					<div className="row w-full">
						<h2 className="mt-1 mb-0">
							<T id="settings" />
						</h2>
					</div>
				</div>
				<div className="row g-0">
					<div className="col-12 col-md-3 border-end">
						<div className="card-body mt-0 pt-0">
							<div className="list-group list-group-transparent">
								<a
									href="#"
									className={`list-group-item list-group-item-action d-flex align-items-center ${
										active === "default-site" ? "active" : ""
									}`}
									onClick={(e) => {
										e.preventDefault();
										setActive("default-site");
									}}
								>
									<T id="settings.default-site" />
								</a>
								<a
									href="#"
									className={`list-group-item list-group-item-action d-flex align-items-center ${
										active === "ldap-auth" ? "active" : ""
									}`}
									onClick={(e) => {
										e.preventDefault();
										setActive("ldap-auth");
									}}
								>
									<T id="settings.ldap.nav" />
								</a>
								<a
									href="#"
									className={`list-group-item list-group-item-action d-flex align-items-center ${
										active === "security" ? "active" : ""
									}`}
									onClick={(e) => {
										e.preventDefault();
										setActive("security");
									}}
								>
									<T id="settings.security.nav" />
								</a>
								<a
									href="#"
									className={`list-group-item list-group-item-action d-flex align-items-center ${
										active === "waf" ? "active" : ""
									}`}
									onClick={(e) => {
										e.preventDefault();
										setActive("waf");
									}}
								>
									<T id="settings.waf.nav" />
								</a>
							</div>
						</div>
					</div>
					<div className="col-12 col-md-9 d-flex flex-column">
						{active === "default-site" ? (
							<DefaultSite />
						) : active === "ldap-auth" ? (
							<LdapAuth />
						) : active === "security" ? (
							<Security />
						) : (
							<Waf />
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
