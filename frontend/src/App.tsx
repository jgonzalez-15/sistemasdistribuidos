import React, { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { TopNavbar } from './components/TopNavbar';
import { LoginView } from './views/LoginView';
import { DashboardView } from './views/DashboardView';
import './styles/dashboard.css';

interface RouteState {
  view: 'login' | 'dashboard' | 'detail';
  intersectionId?: string;
}

function parseHashRoute(isAuthenticated: boolean): RouteState {
  const hash = window.location.hash.replace(/^#/, '') || '/';

  if (!isAuthenticated) {
    return { view: 'login' };
  }

  const detailMatch = hash.match(/^\/intersections\/([a-zA-Z0-9_-]+)/);
  if (detailMatch && detailMatch[1]) {
    return { view: 'detail', intersectionId: detailMatch[1] };
  }

  return { view: 'dashboard' };
}

const AppRouter: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const [route, setRoute] = useState<RouteState>(() => parseHashRoute(isAuthenticated));
  const [isFaultTolerantDemoMode, setIsFaultTolerantDemoMode] = useState<boolean>(false);

  useEffect(() => {
    const syncFromHash = () => {
      const next = parseHashRoute(isAuthenticated);
      setRoute(next);
      if (!isAuthenticated && window.location.hash !== '#/login') {
        window.location.hash = '#/login';
      } else if (
        isAuthenticated &&
        (window.location.hash === '#/login' || !window.location.hash)
      ) {
        window.location.hash = '#/dashboard';
      }
    };

    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, [isAuthenticated]);

  const navigateToFullMap = () => {
    window.location.hash = '#/dashboard';
    setRoute({ view: 'dashboard' });
  };

  const navigateToIntersectionDetail = (intersectionId: string) => {
    window.location.hash = `#/intersections/${intersectionId}`;
    setRoute({ view: 'detail', intersectionId });
  };

  if (!isAuthenticated || route.view === 'login') {
    return <LoginView onLoginSuccess={navigateToFullMap} />;
  }

  return (
    <div className="app-shell">
      <TopNavbar
        onNavigateDashboard={navigateToFullMap}
        currentView={route.view === 'detail' ? 'detail' : 'dashboard'}
        isFaultTolerantDemoMode={isFaultTolerantDemoMode}
        onToggleFaultTolerance={() => setIsFaultTolerantDemoMode((prev) => !prev)}
      />

      <DashboardView
        selectedIntersectionId={route.view === 'detail' ? route.intersectionId || null : null}
        onSelectIntersection={navigateToIntersectionDetail}
        onCloseDetail={navigateToFullMap}
        isFaultTolerantDemoMode={isFaultTolerantDemoMode}
      />
    </div>
  );
};

export function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}

export default App;
