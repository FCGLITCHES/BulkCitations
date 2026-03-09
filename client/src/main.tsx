import React from 'react';
import ReactDOM from 'react-dom/client';
import { Router, Route } from 'wouter';
import Home from './pages/home';
import FAQ from './pages/faq';
import Privacy from './pages/privacy';
import About from './pages/about';
import AdminReportQueue from './components/AdminReportQueue';
import AdminReportDetail from './components/AdminReportDetail';
import Login from './pages/login';
import HistoryPage from './pages/history';
import ScrollToTop from './components/scroll-to-top';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import './dark-mode.css';

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router>
        <ScrollToTop />
        <Route path="/" component={Home} />
        <Route path="/faq" component={FAQ} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/about" component={About} />
        <Route path="/login" component={Login} />
        <Route path="/history" component={HistoryPage} />
        <Route path="/admin/reports" component={AdminReportQueue} />
        <Route path="/admin/reports/:id" component={AdminReportDetail} />
      </Router>
    </QueryClientProvider>
  </React.StrictMode>
);
