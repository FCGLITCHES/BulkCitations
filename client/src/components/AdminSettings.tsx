import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { AdminHeader } from "./AdminHeader";
import { AdminFooter } from "./AdminFooter";
import { adminFetch } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

export default function AdminSettings() {
  const [location] = useLocation();

  return (
    <div className="bg-surface font-body text-on-surface antialiased min-h-screen flex flex-col">
      <AdminHeader />

      <main className="flex-1 min-w-0 bg-surface pt-24">
        <div className="p-8 max-w-7xl mx-auto space-y-8 pb-16">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
            <div className="space-y-1">
              <p className="font-label text-xs uppercase tracking-[0.15em] text-on-surface-variant font-bold">Admin Controls</p>
              <h3 className="font-headline text-4xl text-primary font-bold -tracking-wider">System Settings</h3>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <section className="lg:col-span-2 space-y-6">
              <div className="bg-surface-container-lowest rounded-xl p-8 shadow-[0_24px_48px_-12px_rgba(25,28,30,0.04)] border border-outline-variant/10">
                <h4 className="font-headline text-xl text-primary font-bold mb-6">General Configuration</h4>
                <div className="space-y-6">
                  <div className="flex items-center justify-between p-4 bg-surface-container-low rounded-lg">
                    <div>
                      <p className="font-bold text-sm">Archival Mode</p>
                      <p className="text-xs text-on-surface-variant">Toggle institution-wide archival enforcement.</p>
                    </div>
                    <div className="w-12 h-6 bg-secondary rounded-full relative">
                      <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full"></div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-4 bg-surface-container-low rounded-lg">
                    <div>
                      <p className="font-bold text-sm">Public API Access</p>
                      <p className="text-xs text-on-surface-variant">Allow unauthenticated DOI resolution requests.</p>
                    </div>
                    <div className="w-12 h-6 bg-outline-variant rounded-full relative">
                      <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full"></div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-surface-container-lowest rounded-xl p-8 shadow-[0_24px_48px_-12px_rgba(25,28,30,0.04)] border border-outline-variant/10">
                <h4 className="font-headline text-xl text-primary font-bold mb-6">Citation Engine Sensitivity</h4>
                <div className="space-y-4">
                  <label className="block space-y-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Matching Threshold</span>
                    <input type="range" className="w-full h-1 bg-surface-container-highest accent-secondary rounded-lg appearance-none cursor-pointer" />
                    <div className="flex justify-between text-[10px] font-bold text-on-surface-variant">
                      <span>STRICT</span>
                      <span>BALANCED</span>
                      <span>LENIENT</span>
                    </div>
                  </label>
                </div>
              </div>
            </section>

            <aside className="space-y-6">
              <div className="bg-primary-container p-8 rounded-xl text-white bg-gradient-to-br from-[#000a1e] to-[#002147]">
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
