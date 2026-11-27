// Icon set: lucide-react — the sidebar rides the new set; the rest of the
// panel keeps the stock Tabler icons until its own migration wave.
import { BookOpen, FileText, Home, Lock, Monitor, Settings, ShieldCheck, Users } from "lucide-react";
import cn from "classnames";
import styles from "./SiteMenu.module.css";
import React from "react";
import { HasPermission, NavLink } from "src/components";
import { T } from "src/locale";
import {
	ACCESS_LISTS,
	ADMIN,
	CERTIFICATES,
	DEAD_HOSTS,
	type MANAGE,
	PROXY_HOSTS,
	REDIRECTION_HOSTS,
	type Section,
	STATIC_HOSTS,
	STREAMS,
	VIEW,
} from "src/modules/Permissions";

interface MenuItem {
	label: string;
	icon?: React.ElementType;
	to?: string;
	items?: MenuItem[];
	permissionSection?: Section | typeof ADMIN;
	permission?: typeof VIEW | typeof MANAGE;
}

const menuItems: MenuItem[] = [
	{
		to: "/",
		icon: Home,
		label: "dashboard",
	},
	{
		icon: Monitor,
		label: "hosts",
		items: [
			{
				to: "/nginx/proxy",
				label: "proxy-hosts",
				permissionSection: PROXY_HOSTS,
				permission: VIEW,
			},
			{
				to: "/nginx/redirection",
				label: "redirection-hosts",
				permissionSection: REDIRECTION_HOSTS,
				permission: VIEW,
			},
			{
				to: "/nginx/stream",
				label: "streams",
				permissionSection: STREAMS,
				permission: VIEW,
			},
			{
				to: "/nginx/404",
				label: "dead-hosts",
				permissionSection: DEAD_HOSTS,
				permission: VIEW,
			},
			{
				to: "/nginx/static",
				label: "static-hosts",
				permissionSection: STATIC_HOSTS,
				permission: VIEW,
			},
			],
	},
	{
		to: "/access",
		icon: Lock,
		label: "access-lists",
		permissionSection: ACCESS_LISTS,
		permission: VIEW,
	},
	{
		to: "/certificates",
		icon: ShieldCheck,
		label: "certificates",
		permissionSection: CERTIFICATES,
		permission: VIEW,
	},
	{
		to: "/users",
		icon: Users,
		label: "users",
		permissionSection: ADMIN,
	},
	{
		to: "/audit-log",
		icon: BookOpen,
		label: "auditlogs",
		permissionSection: ADMIN,
	},
	{
		to: "/logs",
		icon: FileText,
		label: "logs",
		permissionSection: ADMIN,
	},
	{
		to: "/settings",
		icon: Settings,
		label: "settings",
		permissionSection: ADMIN,
	},
];

const getMenuItem = (item: MenuItem, onClick?: () => void) => {
	if (item.items && item.items.length > 0) {
		return getMenuDropown(item, onClick);
	}

	return (
		<HasPermission
			key={`item-${item.label}`}
			section={item.permissionSection}
			permission={item.permission || VIEW}
			hideError
		>
			<li className="nav-item">
				<NavLink to={item.to} onClick={onClick}>
					<span className="nav-link-icon d-md-none d-lg-inline-block">
						{item.icon && React.createElement(item.icon, { size: 20 })}
					</span>
					<span className="nav-link-title">
						<T id={item.label} />
					</span>
				</NavLink>
			</li>
		</HasPermission>
	);
};

const getMenuDropown = (item: MenuItem, onClick?: () => void) => {
	const cns = cn("nav-item", "dropdown");
	return (
		<HasPermission
			key={`item-${item.label}`}
			section={item.permissionSection}
			permission={item.permission || VIEW}
			hideError
		>
			<li className={cns}>
				<a
					className="nav-link dropdown-toggle"
					href={item.to}
					data-bs-toggle="dropdown"
					aria-expanded="false"
					role="button"
				>
					<span className="nav-link-icon d-md-none d-lg-inline-block">
						<Monitor size={20} />
					</span>
					<span className="nav-link-title">
						<T id={item.label} />
					</span>
				</a>
				<div className="dropdown-menu">
					{item.items?.map((subitem, idx) => {
						return (
							<HasPermission
								key={`${idx}-${subitem.to}`}
								section={subitem.permissionSection}
								permission={subitem.permission || VIEW}
								hideError
							>
								<NavLink to={subitem.to} isDropdownItem onClick={onClick}>
									<T id={subitem.label} />
								</NavLink>
							</HasPermission>
						);
					})}
				</div>
			</li>
		</HasPermission>
	);
};

export function SiteMenu() {
	const closeMenu = () =>
		setTimeout(() => {
			const navbarToggler = document.querySelector<HTMLElement>(".navbar-toggler");
			const navbarMenu = document.querySelector("#navbar-menu");
			if (navbarToggler && navbarMenu?.classList.contains("show")) {
				navbarToggler.click();
			}
		}, 300);

	return (
		<nav className={cn(styles.sidebar, "navbar-expand-md d-print-none")}>
			<div className="collapse navbar-collapse d-md-block" id="navbar-menu">
				<ul className="navbar-nav flex-column gap-1">
					{menuItems.length > 0 &&
						menuItems.map((item) => {
							return getMenuItem(item, closeMenu);
						})}
				</ul>
			</div>
		</nav>
	);
}