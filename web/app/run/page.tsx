import { PageTitle, TopNav } from "@/components/TopNav";
import { RunAuditForm } from "@/components/RunAuditForm";

export const dynamic = "force-dynamic";

export default function RunAuditPage() {
  return (
    <div className="min-h-screen bg-[#f9f8f6]">
      <TopNav />
      <PageTitle title="Run Audit" />

      <main className="max-w-[900px] mx-auto px-5 lg:px-8 py-8">
        <RunAuditForm />
      </main>
    </div>
  );
}
