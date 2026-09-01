CREATE TYPE "ShopOrderStatus" AS ENUM ('awaiting_coins', 'new', 'completed', 'cancelled');
CREATE TYPE "ShopOrderSource" AS ENUM ('crm', 'student_app', 'website');

ALTER TABLE "ShopProduct"
  ADD COLUMN "imageUrl" TEXT,
  ADD COLUMN "publishedInApp" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "coinPaymentPercent" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ShopProduct"
  ADD CONSTRAINT "ShopProduct_coinPaymentPercent_check"
  CHECK ("coinPaymentPercent" IN (0, 50, 100));

ALTER TABLE "ShopSale"
  ADD COLUMN "coinsSpent" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "coinTransactionId" TEXT,
  ADD COLUMN "cashAmount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "orderId" TEXT;

UPDATE "ShopSale" SET "cashAmount" = "totalAmount";

ALTER TABLE "ShopSaleItem"
  ADD COLUMN "coinPaymentPercent" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "maxCoins" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ShopOrder" (
  "id" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "externalKey" TEXT NOT NULL,
  "source" "ShopOrderSource" NOT NULL DEFAULT 'student_app',
  "status" "ShopOrderStatus" NOT NULL DEFAULT 'new',
  "customerId" TEXT,
  "customerName" TEXT,
  "customerPhone" TEXT,
  "subtotal" INTEGER NOT NULL,
  "discountAmount" INTEGER NOT NULL DEFAULT 0,
  "coinsSpent" INTEGER NOT NULL DEFAULT 0,
  "cashAmount" INTEGER NOT NULL,
  "coinTransactionId" TEXT,
  "coinRefundTransactionId" TEXT,
  "notes" TEXT NOT NULL DEFAULT '',
  "confirmedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "cancellationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShopOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShopOrderItem" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitPrice" INTEGER NOT NULL,
  "purchasePrice" INTEGER NOT NULL,
  "lineTotal" INTEGER NOT NULL,
  "coinPaymentPercent" INTEGER NOT NULL DEFAULT 0,
  "maxCoins" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ShopOrderItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShopSale_orderId_key" ON "ShopSale"("orderId");
CREATE UNIQUE INDEX "ShopOrder_number_key" ON "ShopOrder"("number");
CREATE UNIQUE INDEX "ShopOrder_externalKey_key" ON "ShopOrder"("externalKey");
CREATE INDEX "ShopOrder_status_createdAt_idx" ON "ShopOrder"("status", "createdAt" DESC);
CREATE INDEX "ShopOrder_customerId_createdAt_idx" ON "ShopOrder"("customerId", "createdAt" DESC);
CREATE INDEX "ShopOrderItem_orderId_idx" ON "ShopOrderItem"("orderId");
CREATE INDEX "ShopOrderItem_productId_idx" ON "ShopOrderItem"("productId");

ALTER TABLE "ShopOrder"
  ADD CONSTRAINT "ShopOrder_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ShopOrderItem"
  ADD CONSTRAINT "ShopOrderItem_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "ShopOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ShopOrderItem"
  ADD CONSTRAINT "ShopOrderItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "ShopProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ShopSale"
  ADD CONSTRAINT "ShopSale_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "ShopOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ShopSale"
  ADD CONSTRAINT "ShopSale_coinsSpent_check" CHECK ("coinsSpent" >= 0);

ALTER TABLE "ShopSale"
  ADD CONSTRAINT "ShopSale_amounts_check"
  CHECK (
    "cashAmount" >= 0
    AND "totalAmount" = "cashAmount" + "coinsSpent"
    AND "subtotal" = "discountAmount" + "totalAmount"
  );

ALTER TABLE "ShopSaleItem"
  ADD CONSTRAINT "ShopSaleItem_coinPaymentPercent_check"
  CHECK ("coinPaymentPercent" IN (0, 50, 100));

ALTER TABLE "ShopOrder"
  ADD CONSTRAINT "ShopOrder_amounts_check"
  CHECK (
    "subtotal" >= 0
    AND "discountAmount" >= 0
    AND "coinsSpent" >= 0
    AND "cashAmount" >= 0
    AND "subtotal" = "discountAmount" + "coinsSpent" + "cashAmount"
  );

ALTER TABLE "ShopOrderItem"
  ADD CONSTRAINT "ShopOrderItem_coinPaymentPercent_check"
  CHECK ("coinPaymentPercent" IN (0, 50, 100));

ALTER TABLE "ShopOrderItem"
  ADD CONSTRAINT "ShopOrderItem_amounts_check"
  CHECK ("quantity" > 0 AND "unitPrice" >= 0 AND "lineTotal" >= 0 AND "maxCoins" >= 0);
