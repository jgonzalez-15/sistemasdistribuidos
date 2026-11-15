import React, { useEffect, useRef, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Header, ThemeMode, ViewMode } from './components/Header';
import { LoginView } from './components/LoginView';
import { DashboardView } from './views/DashboardView';
import { SystemBackendView } from './views/SystemBackendView';
import { UserRole } from './types/traffic';
import './index.css';

interface RouteState {
  view: 'login' | 'dashboard' | 'detail' | 'system';
  intersectionId?: string;
}

function parseHashRoute(isAuthenticated: boolean, role?: UserRole): RouteState {
  const hash = window.location.hash.replace(/^#/, '') || '/';

  if (!isAuthenticated) {
    return { view: 'login' };
  }

  if (hash.startsWith('/system')) {
    if (role === 'Administrador') {
      return { view: 'system' };
    }
    return { view: 'dashboard' };
  }

  const detailMatch = hash.match(/^\/intersections\/([a-zA-Z0-9_-]+)/);
  if (detailMatch && detailMatch[1]) {
    return { view: 'detail', intersectionId: detailMatch[1] };
  }

  return { view: 'dashboard' };
}

const AppRouter: React.FC = () => {
  const { isAuthenticated, session } = useAuth();
  const [route, setRoute] = useState<RouteState>(() =>
    parseHashRoute(isAuthenticated, session?.role)
  );
  const [isFaultTolerantDemoMode, setIsFaultTolerantDemoMode] = useState<boolean>(false);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      const saved = window.localStorage.getItem('sgtu_theme');
      return saved === 'light' || saved === 'dark' ? saved : 'dark';
    } catch {
      return 'dark';
    }
  });
  const lastSelectedIdRef = useRef<string>('int-001');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem('sgtu_theme', theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  useEffect(() => {
    const syncFromHash = () => {
      const next = parseHashRoute(isAuthenticated, session?.role);
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
      } else if (
        isAuthenticated &&
        window.location.hash.startsWith('#/system') &&
        session?.role !== 'Administrador'
      ) {
        window.location.hash = '#/dashboard';
      }
    };

    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, [isAuthenticated, session?.role]);

  const navigateToFullMap = () => {
    window.location.hash = '#/dashboard';
    setRoute({ view: 'dashboard' });
  };

  const navigateToIntersectionDetail = (intersectionId: string) => {
    lastSelectedIdRef.current = intersectionId;
    window.location.hash = `#/intersections/${intersectionId}`;
    setRoute({ view: 'detail', intersectionId });
  };

  const navigateToSystemView = () => {
    if (session?.role !== 'Administrador') return;
    window.location.hash = '#/system';
    setRoute({ view: 'system' });
  };

  const handleChangeViewMode = (mode: ViewMode) => {
    if (mode === 'map') {
      navigateToFullMap();
    } else if (mode === 'system') {
      navigateToSystemView();
    } else {
      const targetId = route.intersectionId || lastSelectedIdRef.current || 'int-001';
      navigateToIntersectionDetail(targetId);
    }
  };

  if (!isAuthenticated || route.view === 'login') {
    return (
      <LoginView
        onLoginSuccess={navigateToFullMap}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    );
  }

  const viewMode: ViewMode =
    route.view === 'system' ? 'system' : route.view === 'detail' ? 'split' : 'map';

  return (
    <div className="app-shell">
      <Header
        viewMode={viewMode}
        onChangeViewMode={handleChangeViewMode}
        onNavigateHome={navigateToFullMap}
        isFaultTolerantDemoMode={isFaultTolerantDemoMode}
        onToggleFaultTolerance={() => setIsFaultTolerantDemoMode((prev) => !prev)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      {route.view === 'system' && session?.role === 'Administrador' ? (
        <SystemBackendView
          isFaultTolerantDemoMode={isFaultTolerantDemoMode}
          onToggleFaultTolerance={() => setIsFaultTolerantDemoMode((prev) => !prev)}
        />
      ) : (
        <DashboardView
          selectedIntersectionId={route.view === 'detail' ? route.intersectionId || null : null}
          onSelectIntersection={navigateToIntersectionDetail}
          onCloseDetail={navigateToFullMap}
          isFaultTolerantDemoMode={isFaultTolerantDemoMode}
        />
      )}
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
