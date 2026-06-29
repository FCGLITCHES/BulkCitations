import { AdminRequestError } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

type AdminQueryFeedbackProps = {
  title: string;
  error: unknown;
  onRetry?: () => void;
  className?: string;
  retryLabel?: string;
  variant?: "error" | "warning";
};

type AdminQueryErrorCopy = {
  headline: string;
  detail: string;
  statusLabel: string | null;
};

function getAdminQueryErrorCopy(error: unknown, fallbackTitle: string): AdminQueryErrorCopy {
  if (error instanceof AdminRequestError) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      return {
        headline: `${fallbackTitle} requires a verified admin session.`,
        detail:
          "The admin token was missing, expired, or not accepted. Retry the request, then sign in again if the problem persists.",
        statusLabel: `${error.statusCode}`,
      };
    }

    if (error.statusCode === 503) {
      return {
        headline: `${fallbackTitle} is temporarily unavailable.`,
        detail:
          "The API could not verify admin access or reach a required dependency for this request. Retry once the admin session probe is healthy again.",
        statusLabel: "503",
      };
    }

    return {
      headline: `${fallbackTitle} could not be loaded.`,
      detail: error.message || "The request failed before the analytics payload could be returned.",
      statusLabel: `${error.statusCode}`,
    };
  }

  if (error instanceof Error) {
    return {
      headline: `${fallbackTitle} could not be loaded.`,
      detail: error.message || "The request failed before the analytics payload could be returned.",
      statusLabel: null,
    };
  }

  return {
    headline: `${fallbackTitle} could not be loaded.`,
    detail: "The request failed before the analytics payload could be returned.",
    statusLabel: null,
  };
}

export function AdminQueryFeedback({
  title,
  error,
  onRetry,
  className,
  retryLabel = "Retry",
  variant = "error",
}: AdminQueryFeedbackProps) {
  const copy = getAdminQueryErrorCopy(error, title);
  const isWarning = variant === "warning";

  return (
    <section
      className={cn(
        "rounded-2xl border p-6 shadow-sm",
        isWarning
          ? "border-amber-200 bg-amber-50/90 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
          : "border-red-200 bg-red-50/90 text-red-950 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100",
        className,
      )}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <p className="text-sm font-black uppercase tracking-[0.24em] opacity-75">
            {isWarning ? "Stale data warning" : "Admin request failed"}
          </p>
          <div className="space-y-1">
            <h2 className="font-headline text-xl font-bold">{copy.headline}</h2>
            <p className="max-w-3xl text-sm leading-6 opacity-90">{copy.detail}</p>
          </div>
          {copy.statusLabel ? (
            <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-70">
              HTTP {copy.statusLabel}
            </p>
          ) : null}
        </div>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className={cn(
              "inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2 text-sm font-bold transition-colors",
              isWarning
                ? "bg-amber-900 text-white hover:bg-amber-800 dark:bg-amber-300 dark:text-amber-950 dark:hover:bg-amber-200"
                : "bg-red-900 text-white hover:bg-red-800 dark:bg-red-300 dark:text-red-950 dark:hover:bg-red-200",
            )}
          >
            {retryLabel}
          </button>
        ) : null}
      </div>
    </section>
  );
}
