import { useEffect, useState } from "react";
import { Link } from "wouter";
import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { resolveApiUrl } from "@/lib/api-url";

type ApprovalState = "working" | "success" | "error";

export default function AdminApprove() {
  const [state, setState] = useState<ApprovalState>("working");
  const [message, setMessage] = useState("Validating approval link...");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    if (!token) {
      setState("error");
      setMessage("This approval link is missing its token.");
      return;
    }

    void (async () => {
      const response = await fetch(resolveApiUrl("/internal/admin/approve"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token }),
      });

      const payload = await response.json().catch(() => ({ message: "Approval failed." })) as {
        message?: string;
        alreadyApproved?: boolean;
        account?: { name?: string; username?: string };
      };

      if (!response.ok) {
        setState("error");
        setMessage(payload.message ?? "Approval failed.");
        return;
      }

      const approvedAccount = payload.account?.name || payload.account?.username || "This admin account";
      setState("success");
      setMessage(
        payload.alreadyApproved
          ? `${approvedAccount} is already approved. The admin can sign in right away from the admin portal.`
          : `${approvedAccount} has been approved. They can now sign in from the admin portal and enter the dashboard immediately.`,
      );
    })();
  }, []);

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-slate-100 px-5 py-10">
      <div className="w-full max-w-xl rounded-[2rem] border border-slate-200/80 bg-white/92 p-8 text-center shadow-[0_24px_70px_-36px_rgba(25,28,31,0.28)]">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
          {state === "working" && <ShieldCheck className="h-8 w-8 text-[#002147]" />}
          {state === "success" && <CheckCircle2 className="h-8 w-8 text-emerald-600" />}
          {state === "error" && <XCircle className="h-8 w-8 text-rose-600" />}
        </div>

        <h1 className="mt-6 font-headline text-3xl font-black tracking-tight text-[#001b3d]">
          Admin Approval
        </h1>
        <p className="mt-4 text-sm leading-7 text-slate-600">
          {message}
        </p>

        <div className="mt-8">
          <Link href="/adm1n">
            <span className="inline-flex cursor-pointer items-center justify-center rounded-full bg-[#002147] px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90">
              Open admin portal
            </span>
          </Link>
          <p className="mt-3 text-xs uppercase tracking-[0.24em] text-slate-500">
            Direct route: /adm1n
          </p>
        </div>
      </div>
    </div>
  );
}
