import { IconSettings } from "@tabler/icons-react";
import cn from "classnames";
import EasyModal, { type InnerModalProps } from "ez-modal-react";
import { Field, Form } from "formik";
import { type ReactNode, useState } from "react";
import { Alert } from "react-bootstrap";
import Modal from "react-bootstrap/Modal";
import {
	Button,
	DomainNamesField,
	Loading,
	NginxConfigField,
	SSLCertificateField,
	SSLOptionsFields,
} from "src/components";
import { FormModal } from "src/components/Form";
import { useStaticHost, useSetStaticHost, useUser } from "src/hooks";
import { T } from "src/locale";
import { showObjectSuccess } from "src/notifications";

const showStaticHostModal = (id: number | "new") => {
	EasyModal.show(StaticHostModal, { id });
};

interface Props extends InnerModalProps {
	id: number | "new";
}
const StaticHostModal = EasyModal.create(({ id, visible, remove }: Props) => {
	const { data: currentUser, isLoading: userIsLoading, error: userError } = useUser("me");
	const { data, isLoading, error } = useStaticHost(id);
	const { mutate: setStaticHost } = useSetStaticHost();
	const [errorMsg, setErrorMsg] = useState<ReactNode | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const isAdmin = currentUser?.roles?.includes("admin");

	const onSubmit = async (values: any, { setSubmitting }: any) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setErrorMsg(null);

		const { ...payload } = {
			id: id === "new" ? undefined : id,
			...values,
		};

		// documentRoot: the wire wants null when unset — an empty STRING fails
		// the schema pattern (and an omitted key could not CLEAR the field on
		// edit): null = "no document root" AND stays clearable.
		payload.documentRoot = values.documentRoot || null;
		// Country deny: comma-separated codes in the form, an array on the wire
		payload.countryDeny = String(values.countryDeny || "")
			.split(",")
			.map((c: string) => c.trim())
			.filter(Boolean);
		// Wave 025: how the list is interpreted — "deny" (default) blocks the
		// listed countries, "allow" treats it as a whitelist.
		payload.countryListMode = values.countryListMode || "deny";

		// Wave 024: the WAF and exploits switches ARE API fields on a static
		// host (waf_enabled / block_exploits) — the template arms modsec and
		// the off-hosts get the ctl rule. NO advancedConfig composition.
		payload.wafEnabled = values.wafBlock ?? true;
		payload.blockExploits = values.blockExploits ?? false;
		delete payload.wafDetect;
		delete payload.wafBlock;
		if (!isAdmin) {
			delete payload.advanced_config;
			delete payload.advancedConfig;
		} else {
			// Migration cleaner: strips BOTH the marked block and the bare
			// hand-written WAF directives — a host configured by the OLD
			// (pre-024) switch carries them in advancedConfig, and the
			// template's own arming would duplicate the directives.
			const wafStripRe =
				/\n?# BEGIN PROXYWARDEN WAF[\s\S]*?# END PROXYWARDEN WAF\n?|modsecurity on;\s*modsecurity_rules_file\s+\/etc\/nginx\/modsec\/main(-block)?\.conf;\n?/g;
			payload.advancedConfig = (values.advancedConfig || "").replace(wafStripRe, "");
		}

		setStaticHost(payload, {
			onError: (err: any) => setErrorMsg(<T id={err.message} />),
			onSuccess: () => {
				showObjectSuccess("static-host", "saved");
				remove();
			},
			onSettled: () => {
				setIsSubmitting(false);
				setSubmitting(false);
			},
		});
	};

	return (
		<>
			{(isLoading || userIsLoading || ((error || userError) && (!data || !currentUser))) && (
				<Modal show={visible} onHide={remove}>
					{!isLoading && (error || userError) && (
						<Alert variant="danger" className="m-3">
							{error?.message || userError?.message || "Unknown error"}
						</Alert>
					)}
					{(isLoading || userIsLoading) && <Loading noLogo />}
				</Modal>
			)}
			{!isLoading && !userIsLoading && data && currentUser && (
				<FormModal
					show={visible}
					onHide={remove}
					preventHide={isSubmitting}
					initialValues={
						{
							domainNames: data?.domainNames,
						countryDeny: (data?.countryDeny || []).join(", "),
						countryListMode: data?.countryListMode || "deny",
							certificateId: data?.certificateId,
							sslForced: data?.sslForced,
							advancedConfig: data?.advancedConfig,
							// Wave 024: the static host's WAF and exploits are API FIELDS
							// (waf_enabled / block_exploits) — the template arms modsec,
							// waf_enabled=false gets the Host-matched ctl rule.
							wafBlock: data?.wafEnabled ?? true,
							blockExploits: data?.blockExploits ?? false,
							http2Support: data?.http2Support,
							hstsEnabled: data?.hstsEnabled,
							hstsSubdomains: data?.hstsSubdomains,
							meta: data?.meta || {},
							content: data?.content || "",
							documentRoot: data?.documentRoot || "",
						} as any
					}
					onSubmit={onSubmit}
				>
					{({ onHide }) => (
						<Form>
							<Modal.Header closeButton>
								<Modal.Title>
									<T id={data?.id ? "object.edit" : "object.add"} tData={{ object: "static-host" }} />
								</Modal.Title>
							</Modal.Header>
							<Modal.Body className="p-0">
								<Alert variant="danger" show={!!errorMsg} onClose={() => setErrorMsg(null)} dismissible>
									{errorMsg}
								</Alert>
								<div className="card m-0 border-0">
									<div className="card-header">
										<ul className="nav nav-tabs card-header-tabs" data-bs-toggle="tabs">
											<li className="nav-item" role="presentation">
												<a
													href="#tab-details"
													className="nav-link active"
													data-bs-toggle="tab"
													aria-selected="true"
													role="tab"
												>
													<T id="column.details" />
												</a>
											</li>
											<li className="nav-item" role="presentation">
												<a
													href="#tab-ssl"
													className="nav-link"
													data-bs-toggle="tab"
													aria-selected="false"
													tabIndex={-1}
													role="tab"
												>
													<T id="column.ssl" />
												</a>
											</li>
											{isAdmin && (
												<li className="nav-item ms-auto" role="presentation">
													<a
														href="#tab-advanced"
														className="nav-link"
														title="Settings"
														data-bs-toggle="tab"
														aria-selected="false"
														tabIndex={-1}
														role="tab"
													>
														<IconSettings size={20} />
													</a>
												</li>
											)}
										</ul>
									</div>
									<div className="card-body">
										<div className="tab-content">
											<div className="tab-pane active show" id="tab-details" role="tabpanel">
												<DomainNamesField isWildcardPermitted dnsProviderWildcardSupported />
													<div className="mb-3">
														<label className="form-label" htmlFor="documentRoot">
															<T id="static-host.document-root" />
														</label>
														<Field id="documentRoot" name="documentRoot" type="text" className="form-control font-monospace" placeholder="/data/static-sites/example.com" />
														<div className="form-hint">
															<T id="static-host.document-root-hint" />
														</div>
													</div>
													<div className="mb-3">
														<label className="form-label" htmlFor="shCountryMode">
															<T id="host.country-list-mode" />
														</label>
														<Field name="countryListMode">
															{({ field }: any) => (
																<select {...field} id="shCountryMode" className="form-select">
																	<option value="deny">Deny list (block the listed countries)</option>
																	<option value="allow">Allow list / whitelist</option>
																</select>
															)}
														</Field>
														<div className="form-hint">
															<T id="host.country-list-mode-hint" />
														</div>
													</div>
													<Field name="countryListMode">
														{({ field }: any) => (
															<div className="mb-3">
																<label className="form-label" htmlFor="shCountryDeny">
																	<T id={field.value === "allow" ? "host.country-allow" : "host.country-deny"} />
																</label>
																<Field
																	id="shCountryDeny"
																	name="countryDeny"
																	type="text"
																	className="form-control font-monospace"
																	placeholder="IT, CN, RU"
																	spellCheck={false}
																/>
																<div className="form-hint">
																	<T id={field.value === "allow" ? "host.country-allow-hint" : "host.country-deny-hint"} />
																</div>
															</div>
														)}
													</Field>
													<div className="mb-3">
														<label className="form-label" htmlFor="content">
															<T id="static-host" />
														</label>
													<Field name="content">
														{({ field }: any) => (
															<textarea
																id="content"
																className="form-control font-monospace"
																rows={10}
																spellCheck={false}
																{...field}
															/>
														)}
													</Field>
												</div>
											</div>
											<div className="tab-pane" id="tab-ssl" role="tabpanel">
												<SSLCertificateField
													name="certificateId"
													label="ssl-certificate"
													allowNew
												/>
												<SSLOptionsFields color="bg-red" />
											</div>
											{isAdmin && (
												<div className="tab-pane" id="tab-advanced" role="tabpanel">
													<div className="mb-3">
														<div>
															<label className="row" htmlFor="wafBlock">
																<span className="col">
																	<T id="host.flags.waf-block" />
																</span>
																<span className="col-auto">
																	<Field name="wafBlock" type="checkbox">
																		{({ field, form }: any) => (
																			<label className="form-check form-check-single form-switch">
																				<input
																					id="wafBlock"
																					className={cn("form-check-input", {
																						"bg-lime": field.checked,
																					})}
																					type="checkbox"
																					checked={field.checked}
																					onChange={(e) => {
																						form.setFieldValue("wafBlock", e.target.checked);
																					}}
																				/>
																			</label>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														<div>
															<label className="row" htmlFor="blockExploits">
																<span className="col">
																	<T id="host.flags.block-exploits" />
																</span>
																<span className="col-auto">
																	<Field name="blockExploits" type="checkbox">
																		{({ field, form }: any) => (
																			<label className="form-check form-check-single form-switch">
																				<input
																					id="blockExploits"
																					className={cn("form-check-input", {
																						"bg-lime": field.checked,
																					})}
																					type="checkbox"
																					checked={field.checked}
																					onChange={(e) => {
																						form.setFieldValue("blockExploits", e.target.checked);
																					}}
																				/>
																			</label>
																		)}
																	</Field>
																</span>
															</label>
														</div>
													</div>
													<NginxConfigField />
												</div>
											)}
										</div>
									</div>
								</div>
							</Modal.Body>
							<Modal.Footer>
								<Button data-bs-dismiss="modal" onClick={onHide} disabled={isSubmitting}>
									<T id="cancel" />
								</Button>
								<Button
									type="submit"
									actionType="primary"
									className="ms-auto bg-red"
									data-bs-dismiss="modal"
									isLoading={isSubmitting}
									disabled={isSubmitting}
								>
									<T id="save" />
								</Button>
							</Modal.Footer>
						</Form>
					)}
				</FormModal>
			)}
		</>
	);
});

export { showStaticHostModal };
