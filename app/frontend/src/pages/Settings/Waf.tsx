import { useEffect, useState } from "react";
import { type ReactNode } from "react";
import { Alert } from "react-bootstrap";
import { Button, Loading } from "src/components";
import { useSetWafTuning, useWafTuning } from "src/hooks";
import { T } from "src/locale";
import { showObjectSuccess } from "src/notifications";

export default function Waf() {
	const { data, isLoading, error } = useWafTuning();
	const { mutate: setWafTuning } = useSetWafTuning();
	const [errorMsg, setErrorMsg] = useState<ReactNode | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [exclusions, setExclusions] = useState<{ id: string; note: string }[]>([]);
	const [newId, setNewId] = useState("");
	const [newNote, setNewNote] = useState("");
	const [paranoiaLevel, setParanoiaLevel] = useState(1);

	useEffect(() => {
		if (data) {
			setExclusions(data.exclusions.map((e) => ({ id: String(e.id), note: e.note || "" })));
			setParanoiaLevel(data.paranoiaLevel);
		}
	}, [data]);

	const addExclusion = () => {
		const id = newId.trim();
		if (!/^\d{5,6}$/.test(id)) {
			setErrorMsg(<T id="settings.waf.rule-id-invalid" />);
			return;
		}
		if (exclusions.some((e) => e.id === id)) {
			setErrorMsg(<T id="settings.waf.rule-id-duplicate" />);
			return;
		}
		setErrorMsg(null);
		setExclusions([...exclusions, { id, note: newNote.trim() }]);
		setNewId("");
		setNewNote("");
	};

	const removeExclusion = (id: string) => {
		setExclusions(exclusions.filter((e) => e.id !== id));
	};

	const onSubmit = async (e: any) => {
		e.preventDefault();
		if (isSubmitting) return;
		setIsSubmitting(true);
		setErrorMsg(null);

		setWafTuning(
			{
				exclusions: exclusions.map((ex) => ({
					id: Number(ex.id),
					...(ex.note ? { note: ex.note } : {}),
				})),
				paranoiaLevel,
			},
			{
				onError: (err: any) => setErrorMsg(<T id={err.message} />),
				onSuccess: () => {
					showObjectSuccess("setting", "saved");
				},
				onSettled: () => {
					setIsSubmitting(false);
				},
			},
		);
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
		<form onSubmit={onSubmit}>
			<div className="card-body">
				<Alert variant="danger" show={!!errorMsg} onClose={() => setErrorMsg(null)} dismissible>
					{errorMsg}
				</Alert>

				<div className="mb-3">
					<label className="form-label" htmlFor="waf-paranoia">
						<T id="settings.waf.paranoia" />
					</label>
					<select
						id="waf-paranoia"
						className="form-control"
						value={paranoiaLevel}
						onChange={(e) => setParanoiaLevel(Number(e.target.value))}
					>
						<option value={1}>1</option>
						<option value={2}>2</option>
						<option value={3}>3</option>
						<option value={4}>4</option>
					</select>
					<div className="form-hint">
						<T id="settings.waf.paranoia-hint" />
					</div>
				</div>

				<div className="mb-3">
					<label className="form-label">
						<T id="settings.waf.exclusions" />
					</label>
					{exclusions.length > 0 && (
						<ul className="list-group mb-3">
							{exclusions.map((e) => (
								<li key={e.id} className="list-group-item d-flex align-items-center">
									<code className="font-monospace me-3">{e.id}</code>
									<span className="me-auto text-secondary">{e.note}</span>
									<button type="button" className="btn btn-sm btn-outline-danger" onClick={() => removeExclusion(e.id)}>
										&times;
									</button>
								</li>
							))}
						</ul>
					)}
					<div className="row g-2">
						<div className="col-4">
							<input
								className="form-control font-monospace"
								placeholder="942100"
								value={newId}
								onChange={(e) => setNewId(e.target.value)}
								inputMode="numeric"
							/>
						</div>
						<div className="col">
							<input className="form-control" placeholder="note (optional)" value={newNote} onChange={(e) => setNewNote(e.target.value)} />
						</div>
						<div className="col-auto">
							<Button actionType="secondary" onClick={addExclusion} className="bg-teal">
								<T id="settings.waf.add" />
							</Button>
						</div>
					</div>
					<div className="form-hint">
						<T id="settings.waf.exclusions-hint" />
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
		</form>
	);
}
