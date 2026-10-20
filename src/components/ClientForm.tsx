type Client = { name?: string; email?: string | null; phone?: string | null; company?: string | null; status?: string };

export function ClientForm({ action, client, submitLabel }: { action: (fd: FormData) => void | Promise<void>; client?: Client; submitLabel: string }) {
  return (
    <form action={action}>
      <div className="field">
        <label htmlFor="name">Name</label>
        <input id="name" name="name" defaultValue={client?.name} required maxLength={120} />
      </div>
      <div className="field">
        <label htmlFor="company">Company</label>
        <input id="company" name="company" defaultValue={client?.company ?? ""} maxLength={120} />
      </div>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="field" style={{ flex: 1, minWidth: 200 }}>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" defaultValue={client?.email ?? ""} maxLength={200} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 200 }}>
          <label htmlFor="phone">Phone</label>
          <input id="phone" name="phone" defaultValue={client?.phone ?? ""} maxLength={50} />
        </div>
      </div>
      <div className="field" style={{ maxWidth: 200 }}>
        <label htmlFor="status">Status</label>
        <select id="status" name="status" defaultValue={client?.status ?? "lead"}>
          <option value="lead">Lead</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
      <button className="btn" type="submit">{submitLabel}</button>
    </form>
  );
}
