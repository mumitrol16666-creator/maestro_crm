-- The learning platform used to send avatars with an http:// address (it runs behind the TLS
-- proxy). Upgrade those copies to https; local development addresses stay as they are.
UPDATE "Student"
SET "studentAvatar" = regexp_replace("studentAvatar", '^http://', 'https://')
WHERE "studentAvatar" ~ '^http://[^/]+/api/v1/media/'
  AND "studentAvatar" !~ '^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?/';
