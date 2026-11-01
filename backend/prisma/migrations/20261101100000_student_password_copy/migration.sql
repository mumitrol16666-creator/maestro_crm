-- Encrypted copy of the password for admins (AES-256-GCM, key CRM_PASSWORD_VAULT_KEY outside the database).
-- Existing accounts stay without a copy: only bcrypt hashes exist for them.
ALTER TABLE "Student" ADD COLUMN "passwordEncrypted" TEXT;
ALTER TABLE "Student" ADD COLUMN "passwordEncryptedAt" TIMESTAMP(3);
