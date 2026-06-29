import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminFetch } from "@/lib/admin-api";

// Mirrors the server CslCurrencyStatus (src/admin/cslCurrency.ts).
interface CslStyleSummary {
  engineStyle: string;
  edition: string;
  cslStyleId: string;
}

interface CslCurrencyStatus {
  pinned: { stylesRepo: string; stylesCommit: string; localesRepo: string; localesCommit: string } | null;
  latest: { stylesCommit: string | null; localesCommit: string | null };
  drift: { styles: boolean | null; locales: boolean | null; any: boolean | null };
  upstreamReachable: boolean;
  vendored: boolean;
  lastCheckedAt: string;
  styles: CslStyleSummary[];
  note: string;
}

const STATUS_PATH = "/internal/admin/csl/status";
const queryKey = [STATUS_PATH];

function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 10) : "—";
}

function badge(drift: boolean | null): { label: string; className: string; icon: string } {
  if (drift === true) {
    return {
      label: "Behind upstream",
      icon: "warning",
      className:
        "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200",
    };
  }
  if (drift === false) {
    return {
      label: "Up to date",
      icon: "check_circle",
      className:
        "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200",
    };
  }
  return {
    label: "Unknown (offline)",
    icon: "help",
    className:
      "border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
  };
}

export function AdminCslStatus() {
  const queryClient = useQueryClient();
  const [showStyles, setShowStyles] = React.useState(false);

  const statusQuery = useQuery<CslCurrencyStatus>({
    queryKey,
    queryFn: async () => adminFetch<CslCurrencyStatus>(STATUS_PATH),
    placeholderData: (previous) => previous,
  });

  const refresh = useMutation({
    mutationFn: async () => adminFetch<CslCurrencyStatus>(`${STATUS_PATH}?refresh=1`),
    onSuccess: (status) => queryClient.setQueryData<CslCurrencyStatus>(queryKey, status),
  });

  const status = statusQuery.data;
  const tone = badge(status?.drift.any ?? null);

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.4)] dark:border-slate-800/60 dark:bg-[#121826] dark:shadow-none">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-[15px] font-semibold text-slate-900 dark:text-white">
          CSL currency
        </h3>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider ${tone.className}`}
          >
            <span className="material-symbols-outlined text-base">{tone.icon}</span>
            {tone.label}
          </span>
          <button
            type="button"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-[#002147] hover:text-[#002147] disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700/70 dark:bg-[#0c111b] dark:text-slate-300 dark:hover:border-[#0f4fa8] dark:hover:text-sky-300"
          >
            <span className="material-symbols-outlined text-base">{refresh.isPending ? "sync" : "refresh"}</span>
            Check now
          </button>
        </div>
      </div>

      {statusQuery.isError ? (
        <p className="mt-4 text-sm font-semibold text-red-700 dark:text-red-300">Failed to load CSL status.</p>
      ) : !status ? (
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      ) : (
        <>
          <p className="mt-4 text-sm text-slate-700 dark:text-slate-200">{status.note}</p>

          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Styles pin → latest</dt>
              <dd className="mt-1 font-mono text-xs text-slate-800 dark:text-slate-100">
                {shortSha(status.pinned?.stylesCommit)} → {shortSha(status.latest.stylesCommit)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Locales pin → latest</dt>
              <dd className="mt-1 font-mono text-xs text-slate-800 dark:text-slate-100">
                {shortSha(status.pinned?.localesCommit)} → {shortSha(status.latest.localesCommit)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Vendored</dt>
              <dd className="mt-1 text-xs font-bold text-slate-800 dark:text-slate-100">
                {status.vendored ? "yes" : "no"}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Last checked</dt>
              <dd className="mt-1 text-xs text-slate-800 dark:text-slate-100">
                {new Date(status.lastCheckedAt).toLocaleString()}
              </dd>
            </div>
          </dl>

          <button
            type="button"
            onClick={() => setShowStyles((value) => !value)}
            className="mt-4 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-[#002147] hover:underline dark:text-sky-300"
          >
            <span className="material-symbols-outlined text-base">{showStyles ? "expand_less" : "expand_more"}</span>
            {status.styles.length} tracked styles
          </button>
          {showStyles ? (
            <ul className="mt-2 grid grid-cols-1 gap-1 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-2 lg:grid-cols-3">
              {status.styles.map((style) => (
                <li key={style.engineStyle} className="flex items-baseline gap-1.5">
                  <span className="font-bold text-slate-800 dark:text-slate-100">{style.engineStyle}</span>
                  <span className="text-slate-400">·</span>
                  <span>{style.edition}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}
