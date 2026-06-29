import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { AdminShell } from "./AdminShell";
import { useAdminAuth } from "@/hooks/use-admin-auth";
import { adminFetch } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

type Phase4ModeResponse = {
  mode: "heuristic" | "primary" | "default";
  envMode: "heuristic" | "shadow" | "primary";
  effectiveMode: "heuristic" | "shadow" | "primary";
  primaryFraction: number;
  shadowFraction: number;
  routingSource: "admin_override" | "environment";
  options: Array<{ id: "1" | "2"; label: string; mode: "heuristic" | "primary" }>;
};

type SettingsTabId = "profile" | "system";

const settingsTabs: Array<{
  id: SettingsTabId;
  href: string;
  label: string;
  description: string;
}> = [
  {
    id: "profile",
    href: "/admin/settings/profile",
    label: "Profile details",
    description: "Identity, 2FA guidance, and account governance.",
  },
  {
    id: "system",
    href: "/admin/settings",
    label: "System settings",
    description: "Engine controls, security posture, and platform defaults.",
  },
];

function readableValue(value: string | null | undefined) {
  return value?.trim() || "Not provided";
}

function accountInitials(name: string, username: string | null | undefined) {
  const source = name.trim() || username?.trim() || "Administrator";
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("");
}

function ProfileInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/70">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-slate-900 dark:text-slate-100">{value}</dd>
    </div>
  );
}

function ProfileConfigField({
  id,
  label,
  value,
  onChange,
  helper,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  helper: string;
  type?: "email" | "text";
}) {
  return (
    <label className="block space-y-2" htmlFor={id}>
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{label}</span>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition-colors focus:border-[#002147] focus:bg-white dark:border-slate-700/70 dark:bg-[#0c111b] dark:text-slate-100 dark:focus:border-[#0f4fa8]"
      />
      <span className="block text-xs leading-relaxed text-slate-500 dark:text-slate-400">{helper}</span>
    </label>
  );
}

function TwoFactorOption({
  icon,
  title,
  status,
  description,
  isSelected,
  onSelect,
}: {
  icon: string;
  title: string;
  status: string;
  description: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full gap-4 rounded-xl border bg-white px-4 py-4 text-left transition-colors dark:bg-slate-950",
        isSelected
          ? "border-[#002147] ring-2 ring-[#002147]/15 dark:border-[#0f4fa8] dark:ring-[#0f4fa8]/20"
          : "border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700",
      )}
    >
      <span className="material-symbols-outlined mt-0.5 text-xl text-[#002147] dark:text-sky-300">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{title}</p>
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#002147] dark:bg-blue-500/15 dark:text-sky-200">
            {status}
          </span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{description}</p>
      </div>
    </button>
  );
}

const twoFactorOptions = [
  {
    id: "authenticator",
    icon: "qr_code_2",
    title: "Authenticator app",
    status: "Recommended",
    description: "Connect Google Authenticator, Microsoft Authenticator, Authy, 1Password, or any TOTP-compatible app.",
  },
  {
    id: "passkey",
    icon: "passkey",
    title: "Passkey or security key",
    status: "Strongest",
    description: "Use a platform passkey, YubiKey, Touch ID, Windows Hello, or another WebAuthn-compatible device.",
  },
  {
    id: "sso-provider",
    icon: "hub",
    title: "SSO provider policy",
    status: "Enterprise",
    description: "Connect MFA through Clerk, WorkOS, Okta, Entra ID, Google Workspace, Duo, or another identity provider.",
  },
  {
    id: "backup",
    icon: "mark_email_unread",
    title: "Backup verification",
    status: "Recovery",
    description: "Add verified email, SMS, or recovery codes as fallback factors for account recovery.",
  },
] as const;

function ProfileDetailsPanel({
  account,
  isAdmin,
}: {
  account: ReturnType<typeof useAdminAuth>["account"];
  isAdmin: boolean;
}) {
  const [profileName, setProfileName] = useState(account?.name?.trim() || "");
  const [profileEmail, setProfileEmail] = useState(account?.email?.trim() || "");
  const [profileUsername, setProfileUsername] = useState(account?.username?.trim() || "");
  const [profileRole, setProfileRole] = useState(isAdmin ? "administrator" : "reviewer");
  const [selectedTwoFactor, setSelectedTwoFactor] = useState<(typeof twoFactorOptions)[number]["id"]>("authenticator");
  const displayName = readableValue(account?.name);
  const email = readableValue(account?.email);
  const username = readableValue(account?.username);
  const accountId = readableValue(account?.id);
  const selectedTwoFactorOption = twoFactorOptions.find((option) => option.id === selectedTwoFactor) ?? twoFactorOptions[0];

  useEffect(() => {
    setProfileName(account?.name?.trim() || "");
    setProfileEmail(account?.email?.trim() || "");
    setProfileUsername(account?.username?.trim() || "");
    setProfileRole(isAdmin ? "administrator" : "reviewer");
  }, [account?.email, account?.name, account?.username, isAdmin]);

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
      <section className="space-y-6 lg:col-span-2">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-8 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.4)] dark:border-slate-800/60 dark:bg-[#121826] dark:shadow-none">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[#002147] text-xl font-black uppercase tracking-wider text-white shadow-sm">
                {accountInitials(account?.name ?? "", account?.username)}
              </div>
              <div className="min-w-0">
                <p className="text-xl font-bold text-slate-900 dark:text-white">{displayName}</p>
                <p className="truncate text-sm font-semibold text-slate-600 dark:text-slate-300">{email}</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Administrator profile for BulkReferences operations.</p>
              </div>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2">
            <ProfileConfigField
              id="admin-profile-name"
              label="Full name"
              value={profileName}
              onChange={setProfileName}
              helper="Displayed on admin review, certification, and approval workflows."
            />
            <ProfileConfigField
              id="admin-profile-email"
              label="Email address"
              value={profileEmail}
              onChange={setProfileEmail}
              helper="Used for admin notifications, audit contact, and recovery workflows."
              type="email"
            />
            <ProfileConfigField
              id="admin-profile-username"
              label="Username"
              value={profileUsername}
              onChange={setProfileUsername}
              helper="Short operator handle shown where space is limited."
            />
            <label className="block space-y-2" htmlFor="admin-profile-role">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Admin role</span>
              <select
                id="admin-profile-role"
                value={profileRole}
                onChange={(event) => setProfileRole(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition-colors focus:border-[#002147] focus:bg-white dark:border-slate-700/70 dark:bg-[#0c111b] dark:text-slate-100 dark:focus:border-[#0f4fa8]"
              >
                <option value="owner">Owner</option>
                <option value="administrator">Administrator</option>
                <option value="curator">Gold curator</option>
                <option value="reviewer">Reviewer</option>
                <option value="auditor">Read-only auditor</option>
              </select>
              <span className="block text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Controls access to training, certification, truth overlays, and system operations once profile persistence is wired.
              </span>
            </label>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
            <span>Profile edits are staged in the UI. A profile save endpoint is still needed before changes can persist across sessions.</span>
            <button
              type="button"
              disabled
              className="rounded-lg bg-amber-200/70 px-3 py-2 text-xs font-bold uppercase tracking-wider text-amber-950 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-amber-300/20 dark:text-amber-100"
            >
              Save changes
            </button>
          </div>

          <dl className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            <ProfileInfoRow label="Account ID" value={accountId} />
            <ProfileInfoRow label="Current verified role" value={isAdmin ? "Administrator access active" : "Not currently authorized"} />
          </dl>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-8 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.4)] dark:border-slate-800/60 dark:bg-[#121826] dark:shadow-none">
          <h4 className="mb-2 text-[15px] font-semibold text-slate-900 dark:text-white">Two-factor authentication</h4>
          <p className="mb-6 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            Choose how this admin profile should connect to second-factor verification. The UI now exposes the setup choices; backend factor enrollment is the remaining step.
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {twoFactorOptions.map((option) => (
              <TwoFactorOption
                key={option.id}
                icon={option.icon}
                title={option.title}
                status={option.status}
                description={option.description}
                isSelected={selectedTwoFactor === option.id}
                onSelect={() => setSelectedTwoFactor(option.id)}
              />
            ))}
          </div>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950/70">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#002147] dark:text-sky-300">Selected setup</p>
                <h5 className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">{selectedTwoFactorOption.title}</h5>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">{selectedTwoFactorOption.description}</p>
              </div>
              <span className="rounded-full bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-800">
                Not connected
              </span>
            </div>

            {selectedTwoFactor === "authenticator" ? (
              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-[160px_1fr]">
                <div className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white text-center text-xs font-bold uppercase tracking-[0.12em] text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500">
                  QR code
                  <br />
                  pending
                </div>
                <div className="space-y-3">
                  <ProfileConfigField
                    id="admin-profile-totp-secret"
                    label="Manual setup key"
                    value="XXXX XXXX XXXX XXXX"
                    onChange={() => undefined}
                    helper="Generated by the future 2FA enrollment endpoint for authenticator apps."
                  />
                  <ProfileConfigField
                    id="admin-profile-totp-code"
                    label="Verification code"
                    value=""
                    onChange={() => undefined}
                    helper="Enter the six-digit code from the authenticator app during enrollment."
                  />
                </div>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                disabled
                className="rounded-xl bg-[#002147] px-4 py-3 text-xs font-bold uppercase tracking-wider text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                Connect {selectedTwoFactorOption.title}
              </button>
              <button
                type="button"
                disabled
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                Generate recovery codes
              </button>
            </div>
          </div>
        </div>
      </section>

      <aside className="space-y-6">
        <div className="rounded-2xl bg-[#002147] p-8 text-white shadow-xl">
          <h4 className="mb-4 text-xs font-bold uppercase tracking-widest">Professional controls</h4>
          <div className="space-y-4 text-sm leading-relaxed text-white/85">
            <p>Use this profile as the operator identity for admin training, approved truth certification, and live-engine promotion actions.</p>
            <p>Profile edits, 2FA setup, and recovery flows now have explicit UI slots. The persistence and enrollment endpoints should be added before production enablement.</p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 dark:border-slate-800/60 dark:bg-[#121826]">
          <h4 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Missing to finish</h4>
          <ul className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
            <li className="flex gap-2">
              <span className="material-symbols-outlined text-base text-amber-600 dark:text-amber-300">radio_button_unchecked</span>
              Profile save endpoint for full name, username, email, and role changes.
            </li>
            <li className="flex gap-2">
              <span className="material-symbols-outlined text-base text-amber-600 dark:text-amber-300">radio_button_unchecked</span>
              Real 2FA enrollment endpoint for QR generation, passkeys, SSO factor linking, and recovery codes.
            </li>
            <li className="flex gap-2">
              <span className="material-symbols-outlined text-base text-amber-600 dark:text-amber-300">radio_button_unchecked</span>
              Audit trail showing profile edits, role changes, MFA changes, and recovery-code regeneration.
            </li>
          </ul>
        </div>
      </aside>
    </div>
  );
}

export default function AdminSettings() {
  const queryClient = useQueryClient();
  const [location] = useLocation();
  const { account, isAdmin } = useAdminAuth();
  const activeTab: SettingsTabId = location.startsWith("/admin/settings/profile") ? "profile" : "system";

  const phase4ModeQuery = useQuery({
    queryKey: ["/internal/admin/phase4-mode"],
    queryFn: async () => adminFetch<Phase4ModeResponse>("/internal/admin/phase4-mode"),
    placeholderData: (previousData) => previousData,
  });

  const phase4ModeMutation = useMutation({
    mutationFn: async (mode: "heuristic" | "primary") =>
      adminFetch<Phase4ModeResponse>("/internal/admin/phase4-mode", {
        method: "PUT",
        body: JSON.stringify({ mode }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["/internal/admin/phase4-mode"], data);
    },
  });

  return (
    <AdminShell
      title="Settings"
      subtitle={
        activeTab === "profile"
          ? "Your profile and security."
          : "System controls and engine configuration."
      }
    >
      <div className="space-y-6">
          <nav className="grid grid-cols-1 gap-2 rounded-2xl border border-slate-200/80 bg-white p-2 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.4)] dark:border-slate-800/60 dark:bg-[#121826] dark:shadow-none md:grid-cols-2">
            {settingsTabs.map((tab) => (
              <Link
                key={tab.id}
                href={tab.href}
                className={cn(
                  "rounded-xl px-4 py-3 transition-colors",
                  activeTab === tab.id
                    ? "bg-[#002147] text-white dark:bg-[#0f4fa8]"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white",
                )}
              >
                <span className="block text-sm font-semibold">{tab.label}</span>
                <span className={cn("mt-0.5 block text-xs", activeTab === tab.id ? "text-white/75" : "text-slate-500 dark:text-slate-400")}>
                  {tab.description}
                </span>
              </Link>
            ))}
          </nav>

          {activeTab === "profile" ? (
            <ProfileDetailsPanel
              account={account}
              isAdmin={isAdmin}
            />
          ) : (
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
              <section className="space-y-6 lg:col-span-2">
                <div className="rounded-2xl border border-slate-200/80 bg-white p-8 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.4)] dark:border-slate-800/60 dark:bg-[#121826] dark:shadow-none">
                  <h4 className="mb-6 text-[15px] font-semibold text-slate-900 dark:text-white">General Configuration</h4>
                  <div className="space-y-6">
                    <div className="flex items-center justify-between rounded-lg bg-surface-container-low p-4">
                      <div>
                        <p className="text-sm font-bold">Archival Mode</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Toggle institution-wide archival enforcement.</p>
                      </div>
                      <div className="relative h-6 w-12 rounded-full bg-secondary">
                        <div className="absolute right-1 top-1 h-4 w-4 rounded-full bg-white"></div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-surface-container-low p-4">
                      <div>
                        <p className="text-sm font-bold">Public API Access</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Allow unauthenticated DOI resolution requests.</p>
                      </div>
                      <div className="relative h-6 w-12 rounded-full bg-outline-variant">
                        <div className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white"></div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200/80 bg-white p-8 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.4)] dark:border-slate-800/60 dark:bg-[#121826] dark:shadow-none">
                  <h4 className="mb-6 text-[15px] font-semibold text-slate-900 dark:text-white">Citation Engine Sensitivity</h4>
                  <div className="space-y-4">
                    <label className="block space-y-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Matching Threshold</span>
                      <input
                        type="range"
                        className="h-1 w-full cursor-pointer appearance-none rounded-lg bg-slate-100 accent-[#002147] dark:bg-slate-800 dark:accent-[#0f4fa8]"
                      />
                      <div className="flex justify-between text-[10px] font-bold text-slate-500 dark:text-slate-400">
                        <span>STRICT</span>
                        <span>BALANCED</span>
                        <span>LENIENT</span>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200/80 bg-white p-8 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.4)] dark:border-slate-800/60 dark:bg-[#121826] dark:shadow-none">
                  <h4 className="mb-2 text-[15px] font-semibold text-slate-900 dark:text-white">Phase 4 Internal Switch</h4>
                  <p className="mb-6 text-sm text-slate-600 dark:text-slate-300">
                    Temporary internal override for visible field extraction. <strong>1</strong> forces heuristics, <strong>2</strong> forces full ML.
                  </p>
                  <div className="mb-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => phase4ModeMutation.mutate("heuristic")}
                      disabled={phase4ModeMutation.isPending}
                      className={cn(
                        "rounded-xl border px-4 py-3 text-sm font-bold transition-colors",
                        phase4ModeQuery.data?.effectiveMode === "heuristic"
                          ? "border-[#002147] bg-[#002147] text-white dark:border-[#0f4fa8] dark:bg-[#0f4fa8]"
                          : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200",
                      )}
                    >
                      1 (heuristics)
                    </button>
                    <button
                      type="button"
                      onClick={() => phase4ModeMutation.mutate("primary")}
                      disabled={phase4ModeMutation.isPending}
                      className={cn(
                        "rounded-xl border px-4 py-3 text-sm font-bold transition-colors",
                        phase4ModeQuery.data?.effectiveMode === "primary"
                          ? "border-[#002147] bg-[#002147] text-white dark:border-[#0f4fa8] dark:bg-[#0f4fa8]"
                          : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200",
                      )}
                    >
                      2 (ml)
                    </button>
                  </div>
                  <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
                    <p>
                      Effective mode:{" "}
                      <span className="font-bold text-slate-700 dark:text-slate-200">{phase4ModeQuery.data?.effectiveMode ?? "loading"}</span>
                    </p>
                    <p>
                      Routing:{" "}
                      <span className="font-bold text-slate-700 dark:text-slate-200">
                        {phase4ModeQuery.data
                          ? `${Math.round(phase4ModeQuery.data.primaryFraction * 100)}% primary / ${Math.round(phase4ModeQuery.data.shadowFraction * 100)}% shadow (${phase4ModeQuery.data.routingSource})`
                          : "loading"}
                      </span>
                    </p>
                    <p>
                      Startup env mode: <span className="font-bold text-slate-700 dark:text-slate-200">{phase4ModeQuery.data?.envMode ?? "unknown"}</span>
                    </p>
                    {phase4ModeMutation.error ? <p className="text-red-600 dark:text-red-400">{phase4ModeMutation.error.message}</p> : null}
                  </div>
                </div>
              </section>

              <aside className="space-y-6">
                <div className="rounded-2xl bg-[#002147] p-8 text-white shadow-xl">
                  <h4 className="mb-4 text-xs font-bold uppercase tracking-widest">Security Overview</h4>
                  <p className="mb-6 text-sm leading-relaxed opacity-90">
                    Your system is currently protected by institutional SSO. All administrative actions are logged in the global archive audit.
                  </p>
                  <button className="w-full rounded-lg border border-white/20 bg-white/10 py-3 text-xs font-bold uppercase tracking-widest transition-all hover:bg-white/20">
                    Rotate API Keys
                  </button>
                </div>
              </aside>
            </div>
          )}
        </div>
    </AdminShell>
  );
}
