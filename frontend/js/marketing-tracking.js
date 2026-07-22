(function () {
    const CLIENT_STORAGE_KEY = 'maestro_marketing_client_id';
    const SESSION_STORAGE_KEY = 'maestro_marketing_session_id';
    const ATTRIBUTION_STORAGE_KEY = 'maestro_marketing_attribution';
    const ATTRIBUTION_KEYS = [
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_content',
        'utm_term',
        'gclid',
        'fbclid',
        'ttclid',
        'yclid',
    ];

    function createId(prefix) {
        if (window.crypto?.randomUUID) return `${prefix}_${window.crypto.randomUUID()}`;
        return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    }

    function storageGet(storage, key) {
        try {
            return storage.getItem(key);
        } catch (_) {
            return null;
        }
    }

    function storageSet(storage, key, value) {
        try {
            storage.setItem(key, value);
        } catch (_) {
            // Private browsing or disabled storage should not block a lead form.
        }
    }

    function readJson(storage, key) {
        const value = storageGet(storage, key);
        if (!value) return {};
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_) {
            return {};
        }
    }

    function readCurrentAttribution() {
        const params = new URLSearchParams(window.location.search);
        return ATTRIBUTION_KEYS.reduce((result, key) => {
            const value = String(params.get(key) || '').trim();
            if (value) result[key] = value.slice(0, 220);
            return result;
        }, {});
    }

    function getAttribution() {
        const stored = readJson(window.localStorage, ATTRIBUTION_STORAGE_KEY);
        const current = readCurrentAttribution();
        const firstTouch = stored.firstTouch && typeof stored.firstTouch === 'object'
            ? stored.firstTouch
            : {};
        const nextFirstTouch = Object.keys(firstTouch).length ? firstTouch : current;
        const lastTouch = { ...(stored.lastTouch || {}), ...current };
        const next = {
            ...lastTouch,
            firstTouch: nextFirstTouch,
            lastTouch,
        };
        if (Object.keys(current).length || Object.keys(stored).length) {
            storageSet(window.localStorage, ATTRIBUTION_STORAGE_KEY, JSON.stringify(next));
        }
        return next;
    }

    function getContext() {
        let clientId = storageGet(window.localStorage, CLIENT_STORAGE_KEY);
        if (!clientId) {
            clientId = createId('client');
            storageSet(window.localStorage, CLIENT_STORAGE_KEY, clientId);
        }

        let sessionId = storageGet(window.sessionStorage, SESSION_STORAGE_KEY);
        if (!sessionId) {
            sessionId = createId('session');
            storageSet(window.sessionStorage, SESSION_STORAGE_KEY, sessionId);
        }

        return {
            clientId,
            sessionId,
            attribution: getAttribution(),
            landingUrl: window.location.href,
            referrerUrl: document.referrer || null,
        };
    }

    function track(eventName, payload = {}) {
        const context = getContext();
        const body = {
            eventName,
            clientId: context.clientId,
            sessionId: context.sessionId,
            attribution: context.attribution,
            pageUrl: window.location.href,
            referrer: document.referrer || null,
            payload: payload && typeof payload === 'object' ? payload : {},
        };
        if (payload?.bookingId) body.bookingId = String(payload.bookingId);

        return fetch('/api/marketing/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            keepalive: true,
        }).catch(() => undefined);
    }

    window.MaestroMarketing = {
        getContext,
        track,
    };

    track('page_view', { page: window.location.pathname });
})();
