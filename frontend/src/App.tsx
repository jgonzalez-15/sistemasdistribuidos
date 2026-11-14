import React, { useEffect, useRef, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Header, ViewMode } from './components/Header';
import { LoginView } from './components/LoginView';
import { DashboardView } from './views/DashboardView';
import './index.css';

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
  const lastSelectedIdRef = useRef<string>('int-001');

  useEffect(() => {
    const syncFromHash = () => {
      const next = parseHashRoute(isAuthenticated);
      if (next.intersectionId) {
        lastSelectedIdRef.current = next.intersectionId;
      }
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
    lastSelectedIdRef.current = intersectionId;
    window.location.hash = `#/intersections/${intersectionId}`;
    setRoute({ view: 'detail', intersectionId });
  };

  const handleChangeViewMode = (mode: ViewMode) => {
    if (mode === 'map') {
      navigateToFullMap();
    } else {
      const targetId = route.intersectionId || lastSelectedIdRef.current || 'int-001';
      navigateToIntersectionDetail(targetId);
    }
  };

  if (!isAuthenticated || route.view === 'login') {
    return <LoginView onLoginSuccess={navigateToFullMap} />;
  }

  const viewMode: ViewMode = route.view === 'detail' ? 'split' : 'map';

  return (
    <div className="app-shell">
      <Header
        viewMode={viewMode}
        onChangeViewMode={handleChangeViewMode}
        onNavigateHome={navigateToFullMap}
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
