
(async function () {
    // Increment this version to force a global cache clear and reload
    const CACHE_BUSTER_VERSION = '2026-07-02-v22';

    try {
        const lastVersion = localStorage.getItem('cache_buster_version');

        // If version mismatch or force flag is present
        if (CACHE_BUSTER_VERSION !== lastVersion) {
            console.log(`[CacheBuster] New version detected: ${CACHE_BUSTER_VERSION} (was ${lastVersion}). Cleaning up...`);

            // 1. Unregister all Service Workers
            if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                for (const registration of registrations) {
                    await registration.unregister();
                    console.log('[CacheBuster] SW Unregistered:', registration.scope);
                }
            }

            // 2. Clear all Caches (Storage)
            if ('caches' in window) {
                const keys = await caches.keys();
                await Promise.all(keys.map(key => caches.delete(key)));
                console.log('[CacheBuster] Caches cleared.');
            }

            // 3. Mark as cleaned
            localStorage.setItem('cache_buster_version', CACHE_BUSTER_VERSION);

            // 4. Force Reload from Server (ignoring cache)
            console.log('[CacheBuster] Reloading page...');
            window.location.reload(true);
        } else {
            console.log('[CacheBuster] System is up to date.');
        }
    } catch (e) {
        console.error('[CacheBuster] Error:', e);
    }
})();
