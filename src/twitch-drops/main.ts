import { initializeCampaigns } from './campaigns';
import { initializeInventory } from './inventory';

// Development hot reload
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    location.reload();
  });
}

type DropsRoute = 'campaigns' | 'inventory' | undefined;

function dropsRouteFromLocation(): DropsRoute {
  const { pathname } = location;
  if (pathname.includes('/drops/campaigns')) return 'campaigns';
  if (pathname.includes('/drops/inventory')) return 'inventory';
  return undefined;
}

function watchLocation(onChange: () => void): void {
  let lastHref = location.href;
  const notify = (): void => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    onChange();
  };

  addEventListener('popstate', notify);

  const navigation = (globalThis as { navigation?: EventTarget }).navigation;
  if (navigation) {
    navigation.addEventListener('currententrychange', notify);
    return;
  }

  const { pushState, replaceState } = history;
  history.pushState = function (
    ...stateArguments: Parameters<History['pushState']>
  ) {
    Reflect.apply(pushState, history, stateArguments);
    notify();
  };
  history.replaceState = function (
    ...stateArguments: Parameters<History['replaceState']>
  ) {
    Reflect.apply(replaceState, history, stateArguments);
    notify();
  };
}

function start(): void {
  let activeRoute: DropsRoute;
  let stopActive: (() => void) | undefined;

  const syncRoute = (): void => {
    const route = dropsRouteFromLocation();
    if (route === activeRoute) return;

    stopActive?.();
    stopActive = undefined;
    activeRoute = route;

    if (route === 'campaigns') {
      stopActive = initializeCampaigns();
    } else if (route === 'inventory') {
      stopActive = initializeInventory();
    }
  };

  watchLocation(syncRoute);
  syncRoute();
}

start();
