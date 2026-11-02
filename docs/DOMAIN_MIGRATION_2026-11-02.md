# Maestro domains — 2026-11-02

Canonical URLs: CRM https://crm.maestro.com.kz, learning platform https://app.maestro.com.kz.
Both A records point to the existing VPS 178.105.59.89. Website, shop, ticketing and mail DNS are unchanged.

## Server rollout

1. Back up Nginx sites and both server env files in a root-only directory under /var/backups/maestro.
2. Serve /.well-known/acme-challenge/ for both new hostnames; issue the TLS certificate with Certbot webroot.
3. Install separate Nginx vhosts for the new domains, copying the existing CRM and learning-platform upstreams and limits. Keep legacy DuckDNS vhosts and certificates active. Verify nginx -t before reload.
4. CRM backend .env: FRONTEND_URL=https://crm.maestro.com.kz, LEARNING_PLATFORM_URL=https://app.maestro.com.kz. Keep internal API URLs on loopback.
5. Platform backend .env: allow https://app.maestro.com.kz, https://crm.maestro.com.kz, https://maestro.com.kz and both legacy HTTPS origins in CORS_ORIGIN. Keep existing JWT, SSO, integration, VAPID and password-vault keys.
6. Deploy checked immutable commits. The frontend uses relative /api/v1 so canonical and legacy origins keep independent working sessions. Check health, release fingerprints, preflight, private files, CORS, sign-in screens and SSO destination.
7. Keep old hosts available during transition: existing PWA storage and push subscriptions are origin-specific, and the published Android APK still launches the legacy hostname. New browser origin needs a fresh sign-in and its own notification permission/install. Do not redirect API POSTs or remove legacy domains during this stage.

No real-user passwords or balances are changed to test this migration. The Android signing key/SDK are not in the deployment checkout; a new signed APK is a separate release with the existing signing identity.

## Recovery

The pre-migration protected server configuration backup contains the original env files and Nginx sites. Restore only the relevant config and reload the affected processes after nginx -t. Revert the domain source commit through Git for a code rollback. Database schema and existing user accounts are unchanged by this migration.
