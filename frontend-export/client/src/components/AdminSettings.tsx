import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { AdminHeader } from "./AdminHeader";
import { AdminFooter } from "./AdminFooter";
import { adminFetch } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

export default function AdminSettings() {
  const [location] = useLocation();

  return (
    <div className="min-h-screen bg-slate-100 font-body text-slate-900 antialiased dark:bg-[#11161d] dark:text-slate-100 flex flex-col">
      <AdminHeader />

      <main className="flex-1 min-w-0 bg-transparent pt-24">
        <div className="p-8 max-w-7xl mx-auto space-y-8 pb-16">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
            <div className="space-y-1">
              <p className="font-label text-xs uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400 font-bold">Admin Controls</p>
              <h3 className="font-headline text-4xl text-[#0f4fa8] dark:text-blue-300 font-bold -tracking-wider">System Settings</h3>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <section className="lg:col-span-2 space-y-6">
              <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-8 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.28)] dark:border-slate-700/80 dark:bg-slate-900">
                <h4 className="font-headline text-xl text-[#0f4fa8] dark:text-blue-300 font-bold mb-6">General Configuration</h4>
                <div className="space-y-6">
                  <div className="flex items-center justify-between p-4 bg-surface-container-low rounded-lg">
                    <div>
                      <p className="font-bold text-sm">Archival Mode</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Toggle institution-wide archival enforcement.</p>
                    </div>
                    <div className="w-12 h-6 bg-secondary rounded-full relative">
                      <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full"></div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-4 bg-surface-container-low rounded-lg">
                    <div>
                      <p className="font-bold text-sm">Public API Access</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Allow unauthenticated DOI resolution requests.</p>
                    </div>
                    <div className="w-12 h-6 bg-outline-variant rounded-full relative">
                      <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full"></div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-8 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.28)] dark:border-slate-700/80 dark:bg-slate-900">
                <h4 className="font-headline text-xl text-[#0f4fa8] dark:text-blue-300 font-bold mb-6">Citation Engine Sensitivity</h4>
                <div className="space-y-4">
                  <label className="block space-y-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Matching Threshold</span>
                    <input type="range" className="w-full h-1 bg-slate-100 dark:bg-slate-800 accent-[#0f4fa8] dark:accent-blue-400 rounded-lg appearance-none cursor-pointer" />
                    <div className="flex justify-between text-[10px] font-bold text-slate-500 dark:text-slate-400">
                      <span>STRICT</span>
                      <span>BALANCED</span>
                      <span>LENIENT</span>
                    </div>
                  </label>
                </div>
              </div>
            </section>

            <aside className="space-y-6">
              <div className="p-8 rounded-2xl text-white bg-[#002147] shadow-xl">
                <h4 className="text-xs font-bold uppercase tracking-widest mb-4">Security Overview</h4>
                <p className="text-sm opacity-90 leading-relaxed mb-6">Your system is currenty protected by military-grade encryption and institutional SSO. All administrative actions are logged in the global archive audit.</p>
                <button className="w-full py-3 bg-white/10 hover:bg-white/20 rounded-lg text-xs font-bold transition-all border border-white/20 uppercase tracking-widest">Rotate API Keys</button>
              </div>
            </aside>
          </div>
        </div>
      </main>

      <AdminFooter />
    </div>
  );
}
