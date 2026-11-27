import { Field, Form, Formik } from "formik";
import { type ReactNode, useState } from "react";
import { Alert } from "react-bootstrap";
import { Button, Loading } from "src/components";
import { useSetSetting, useSetting } from "src/hooks";
import { T } from "src/locale";
import { showObjectSuccess } from "src/notifications";

export default function LdapAuth() {
	const { data, isLoading, error } = useSetting("ldap-auth");
	const { mutate: setSetting } = useSetSetting();
	const [errorMsg, setErrorMsg] = useState<ReactNode | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const onSubmit = async (values: any, { setSubmitting }: any) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setErrorMsg(null);

		const payload = {
			id: "ldap-auth",
			value: values.enabled ? "enabled" : "disabled",
			meta: {
				enabled: !!values.enabled,
				url: values.url || "",
				bindDn: values.bindDn || "",
				bindPassword: values.bindPassword || "",
				baseDn: values.baseDn || "",
				filter: values.filter || "(uid={username})",
				starttls: !!values.starttls,
				provisionOnLogin: !!values.provisionOnLogin,
				defaultVisibility: values.defaultVisibility || "user",
			},
		};

		setSetting(payload, {
			onError: (err: any) => setErrorMsg(<T id={err.message} />),
			onSuccess: () => {
				showObjectSuccess("setting", "saved");
			},
			onSettled: () => {
				setIsSubmitting(false);
				setSubmitting(false);
			},
		});
	};

	if (!isLoading && error) {
		return (
			<div className="card-body">
				<div className="mb-3">
					<Alert variant="danger" show>
						{error.message}
					</Alert>
				</div>
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="card-body">
				<div className="mb-3">
					<Loading noLogo />
				</div>
			</div>
		);
	}

	return (
		<Formik
			initialValues={
				{
					enabled: !!data?.meta?.enabled,
					url: data?.meta?.url || "",
					bindDn: data?.meta?.bindDn || "",
					bindPassword: data?.meta?.bindPassword || "",
					baseDn: data?.meta?.baseDn || "",
					filter: data?.meta?.filter || "(uid={username})",
					starttls: !!data?.meta?.starttls,
					provisionOnLogin: data?.meta?.provisionOnLogin !== false,
					defaultVisibility: data?.meta?.defaultVisibility || "user",
				} as any
			}
			onSubmit={onSubmit}
		>
			{() => (
				<Form>
					<div className="card-body">
						<Alert variant="danger" show={!!errorMsg} onClose={() => setErrorMsg(null)} dismissible>
							{errorMsg}
						</Alert>
						<div className="mb-3">
							<label className="form-label" htmlFor="ldap-enabled">
								<T id="settings.ldap.enabled" />
							</label>
							<div>
								<Field name="enabled" type="checkbox">
									{({ field }: any) => (
										<label className="form-check form-switch">
											<input
												id="ldap-enabled"
												className="form-check-input"
												type="checkbox"
												{...field}
											/>
										</label>
									)}
								</Field>
							</div>
							<div className="form-hint">
								<T id="settings.ldap.enabled-hint" />
							</div>
						</div>
						<div className="mb-3">
							<label className="form-label" htmlFor="ldap-url">
								<T id="settings.ldap.url" />
							</label>
							<Field id="ldap-url" name="url" type="text" className="form-control" placeholder="ldap://ldap.example.com:389" />
						</div>
						<div className="mb-3">
							<label className="form-label" htmlFor="ldap-binddn">
								<T id="settings.ldap.binddn" />
							</label>
							<Field id="ldap-binddn" name="bindDn" type="text" className="form-control" />
							<div className="form-hint">
								<T id="settings.ldap.binddn-hint" />
							</div>
						</div>
						<div className="mb-3">
							<label className="form-label" htmlFor="ldap-bindpassword">
								<T id="settings.ldap.bindpassword" />
							</label>
							<Field id="ldap-bindpassword" name="bindPassword" type="password" className="form-control" autoComplete="off" />
						</div>
						<div className="mb-3">
							<label className="form-label" htmlFor="ldap-basedn">
								<T id="settings.ldap.basedn" />
							</label>
							<Field id="ldap-basedn" name="baseDn" type="text" className="form-control" placeholder="ou=users,dc=example,dc=com" />
						</div>
						<div className="mb-3">
							<label className="form-label" htmlFor="ldap-filter">
								<T id="settings.ldap.filter" />
							</label>
							<Field id="ldap-filter" name="filter" type="text" className="form-control font-monospace" />
							<div className="form-hint">
								<T id="settings.ldap.filter-hint" />
							</div>
						</div>
						<div className="mb-3">
							<label className="form-label" htmlFor="ldap-starttls">
								<T id="settings.ldap.starttls" />
							</label>
							<div>
								<Field name="starttls" type="checkbox">
									{({ field }: any) => (
										<label className="form-check form-switch">
											<input
												id="ldap-starttls"
												className="form-check-input"
												type="checkbox"
												{...field}
											/>
										</label>
									)}
								</Field>
							</div>
						</div>
						<div className="mb-3">
							<label className="form-label" htmlFor="ldap-provision">
								<T id="settings.ldap.provision" />
							</label>
							<div>
								<Field name="provisionOnLogin" type="checkbox">
									{({ field }: any) => (
										<label className="form-check form-switch">
											<input
												id="ldap-provision"
												className="form-check-input"
												type="checkbox"
												{...field}
											/>
										</label>
									)}
								</Field>
							</div>
							<div className="form-hint">
								<T id="settings.ldap.provision-hint" />
							</div>
						</div>
						<div className="mb-3">
							<label className="form-label" htmlFor="ldap-visibility">
								<T id="settings.ldap.visibility" />
							</label>
							<Field id="ldap-visibility" name="defaultVisibility" as="select" className="form-control">
								<option value="user">user</option>
								<option value="all">all</option>
							</Field>
						</div>
					</div>
					<div className="card-footer text-end">
						<div className="d-flex">
							<Button type="submit" actionType="primary" className="ms-auto bg-teal" isLoading={isSubmitting} disabled={isSubmitting}>
								<T id="save" />
							</Button>
						</div>
					</div>
				</Form>
			)}
		</Formik>
	);
}
