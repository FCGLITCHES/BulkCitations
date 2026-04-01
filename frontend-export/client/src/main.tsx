import React from 'react';
import ReactDOM from 'react-dom/client';
import { Router, Route, useLocation } from 'wouter';
import Home from './pages/home';
import FAQ from './pages/faq';
import Privacy from './pages/privacy';
import About from './pages/about';
import Contact from './pages/contact';
import AdminReportQueue from './components/AdminReportQueue';
import AdminReportDetail from './components/AdminReportDetail';
import AdminAnalytics from './components/AdminAnalytics';
import AdminDashboard from './components/AdminDashboard';
import AdminSystemHealth from './components/AdminSystemHealth';
import AdminSettings from './components/AdminSettings';
import AdminReferences from './components/AdminReferences';
import Login from './pages/login';
import AdminLogin from './pages/admin-login';
import AdminApprove from './pages/admin-approve';
import HistoryPage from './pages/history';
import Prices from './pages/prices';
import Resources from './pages/resources';
import ApiDocs from './pages/api-docs';
import InstitutionalLogin from './pages/institutional-login';
import ScrollToTop from './components/scroll-to-top';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { useAuth } from './hooks/use-auth';
import { trackAnalyticsEvent } from './lib/analytics';
import './index.css';

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { isAdmin, isInitialized } = useAuth();
  const [, setLocation] = useLocation();

  React.useEffect(() => {
    if (isInitialized && !isAdmin) {
      setLocation('/adm1n');
    }
  }, [isAdmin, isInitialized, setLocation]);

  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4 text-sm text-muted-foreground">
        Checking admin session...
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4 text-sm text-muted-foreground">
        Redirecting to admin login...
      </div>
    );
  }

  return <>{children}</>;
}

function AdminQueueRoute() {
  return (
    <RequireAdmin>
      <AdminReportQueue />
    </RequireAdmin>
  );
}

function AdminDetailRoute() {
  return (
    <RequireAdmin>
      <AdminReportDetail />
    </RequireAdmin>
  );
}

function AdminAnalyticsRoute() {
  return (
    <RequireAdmin>
      <AdminAnalytics />
    </RequireAdmin>
  );
}

function AdminDashboardRoute() {
  return (
    <RequireAdmin>
      <AdminDashboard />
    </RequireAdmin>
  );
}

function AdminHealthRoute() {
  return (
    <RequireAdmin>
      <AdminSystemHealth />
    </RequireAdmin>
  );
}

function AdminSettingsRoute() {
  return (
    <RequireAdmin>
      <AdminSettings />
    </RequireAdmin>
  );
}

function AdminReferencesRoute() {
  return (
    <RequireAdmin>
      <AdminReferences />
    </RequireAdmin>
  );
}

function AnalyticsRouteTracker() {
  const [location] = useLocation();

  React.useEffect(() => {
    if (location.startsWith("/admin")) return;
    if (location === "/login") return;
    if (location.startsWith("/adm1n")) return;
    if (location === "/admin-login") return;

    trackAnalyticsEvent("page_view", {
      surface: location === "/" ? "home" : "site",
      route: location,
    });
  }, [location]);

  return null;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router>
        <ScrollToTop />
        <AnalyticsRouteTracker />
        <Route path="/" component={Home} />
        <Route path="/faq" component={FAQ} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/about" component={About} />
        <Route path="/contact" component={Contact} />
        <Route path="/login" component={Login} />
        <Route path="/adm1n" component={AdminLogin} />
        <Route path="/admin-login" component={AdminLogin} />
        <Route path="/adm1n/approve" component={AdminApprove} />
        <Route path="/history" component={HistoryPage} />
        <Route path="/prices" component={Prices} />
        <Route path="/resources" component={Resources} />
        <Route path="/api-docs" component={ApiDocs} />
        <Route path="/institutional-login" component={InstitutionalLogin} />
        <Route path="/admin" component={AdminDashboardRoute} />
        <Route path="/admin/dashboard" component={AdminDashboardRoute} />
        <Route path="/admin/reports" component={AdminQueueRoute} />
        <Route path="/admin/analytics" component={AdminAnalyticsRoute} />
        <Route path="/admin/health" component={AdminHealthRoute} />
        <Route path="/admin/settings" component={AdminSettingsRoute} />
        <Route path="/admin/references" component={AdminReferencesRoute} />
        <Route path="/admin/reports/:id" component={AdminDetailRoute} />
      </Router>
    </QueryClientProvider>
  </React.StrictMode>
);
