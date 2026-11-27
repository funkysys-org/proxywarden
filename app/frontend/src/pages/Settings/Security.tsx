import { Field, Form, Formik } from "formik";
import { type ReactNode, useState } from "react";
import { Alert } from "react-bootstrap";
import { Button, Loading } from "src/components";
import { useSetSetting, useSetting } from "src/hooks";
import { T } from "src/locale";
import { showObjectSuccess } from "src/notifications";

export default function Security() {
	const { data, isLoading, error } = useSetting("2fa-policy");
	const { mutate: setSetting } = useSetSetting();
	const [errorMsg, setErrorMsg] = useState<ReactNode | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const onSubmit = async (values: any, { setSubmitting }: any) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setErrorMsg(null);

		const payload = {
			id: "2fa-policy",
			value: values.enabled ? "enabled" : "disabled",
			meta: {
				enabled: !!values.enabled,
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
		<Formik initialValues={{ enabled: !!data?.meta?.enabled } as any} onSubmit={onSubmit}>
			{() => (
				<Form>
					<div className="card-body">
						<Alert variant="danger" show={!!errorMsg} onClose={() => setErrorMsg(null)} dismissible>
							{errorMsg}
						</Alert>
						<div className="mb-3">
							<label className="form-label" htmlFor="policy-2fa-enabled">
								<T id="settings.security.2fa-required" />
							</label>
							<div>
								<Field name="enabled" type="checkbox">
									{({ field }: any) => (
										<label className="form-check form-switch">
											<input
												id="policy-2fa-enabled"
												className="form-check-input"
												type="checkbox"
												{...field}
											/>
										</label>
									)}
								</Field>
							</div>
							<div className="form-hint">
								<T id="settings.security.2fa-required-hint" />
							</div>
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
