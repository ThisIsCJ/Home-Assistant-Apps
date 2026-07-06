import { useEffect, useRef } from 'react';
import { fetchAppConfig } from '../lib/appConfig.js';
import { buildUserManager, getActiveProviderKey, debugAuthError } from './oidcConfig.js';

export function AuthSilentCallback() {
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    async function handleSilent() {
      const config = await fetchAppConfig();
      const providerKey = getActiveProviderKey();
      if (!providerKey || !config.authProviders?.length) return;
      const providerCfg = config.authProviders.find(p => p.provider === providerKey);
      if (!providerCfg) return;
      const mgr = buildUserManager(providerKey, providerCfg);
      if (!mgr) return;
      mgr.signinSilentCallback().catch(err => debugAuthError('Silent sign-in callback failed', err));
    }

    handleSilent();
  }, []);

  return null;
}
