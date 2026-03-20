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
import Login from './pages/login';
import HistoryPage from './pages/history';
import ScrollToTop from './components/scroll-to-top';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { useAuth } from './hooks/use-auth';
import './index.css';

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { isAdmin, isInitialized } = useAuth();
  const [, setLocation] = useLocation();

  React.useEffect(() => {
    if (isInitialized && !isAdmin) {
      setLocation('/login');
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router>
        <ScrollToTop />
        <Route path="/" component={Home} />
        <Route path="/faq" component={FAQ} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/about" component={About} />
        <Route path="/contact" component={Contact} />
        <Route path="/login" component={Login} />
        <Route path="/history" component={HistoryPage} />
        <Route path="/admin/reports" component={AdminQueueRoute} />
        <Route path="/admin/reports/:id" component={AdminDetailRoute} />
      </Router>
    </QueryClientProvider>
  </React.StrictMode>
);
