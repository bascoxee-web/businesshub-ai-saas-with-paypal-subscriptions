import { requireWorkspace } from "@/lib/auth";
import { Banner } from "@/components/Banner";
import { ClientForm } from "@/components/ClientForm";
import { createClientAction } from "../actions";

export const metadata = { title: "New client" };

export default async function NewClientPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  await requireWorkspace();
  return (
    <>
      <h1>New client</h1>
      <Banner error={sp.error} />
      <div className="card" style={{ maxWidth: 620 }}>
        <ClientForm action={createClientAction} submitLabel="Save client" />
      </div>
    </>
  );
}
