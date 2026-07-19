const shopState = {
    tab: 'sale',
    products: [],
    categories: [],
    summary: {},
    movements: [],
    sales: [],
    cart: new Map(),
    productSearch: '',
    productCategory: '',
    productStock: 'all',
    saleSearch: '',
    saleStatus: '',
    checkout: {
        customerName: '',
        customerPhone: '',
        paymentMethod: 'kaspi',
        discountAmount: 0,
        notes: '',
    },
    pending: false,
};

function shopEsc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function shopMoney(value) {
    return `${new Intl.NumberFormat('ru-RU').format(Math.round(Number(value) || 0))} ₸`;
}

function shopDate(value, withTime = false) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('ru-RU', withTime
        ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function shopLocalDateInput(date = new Date()) {
    const value = date instanceof Date ? date : new Date(date);
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function shopCanManageInventory() {
    return ['admin', 'super_admin'].includes(getUserRole());
}

function shopIcon(name, size = 18) {
    const paths = {
        cart: '<circle cx="9" cy="20" r="1"/><circle cx="19" cy="20" r="1"/><path d="M3 4h2l2.4 11.4a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 8H6"/>',
        box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        receive: '<path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 21h14"/>',
        history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
        products: '<path d="M4 7h16v14H4zM7 7V4h10v3M8 11h8"/>',
        edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
        refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7L20 14"/><path d="M20 7v7h-7"/>',
        search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
        trash: '<path d="M3 6h18M8 6V4h8v2m-9 0 1 15h8l1-15M10 10v7m4-7v7"/>',
        adjust: '<path d="M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3M1 14h6M9 8h6m2 8h6"/>',
        close: '<path d="m6 6 12 12M18 6 6 18"/>',
        minus: '<path d="M5 12h14"/>',
        check: '<path d="m5 12 4 4L19 6"/>',
    };
    return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.box}</svg>`;
}

async function shopRequest(path, options = {}) {
    const response = await fetch(`${API_URL}/shop${path}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${getAuthToken()}`,
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.idempotencyKey ? { 'X-Idempotency-Key': options.idempotencyKey } : {}),
            ...(options.headers || {}),
        },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) {
        const error = new Error(result.error || 'Ошибка магазина');
        error.code = result.code;
        throw error;
    }
    return result;
}

function shopSummaryMetric(label, value, note, tone = '') {
    return `
        <div class="shop-metric ${tone ? `is-${tone}` : ''}">
            <span>${shopEsc(label)}</span>
            <strong>${shopEsc(value)}</strong>
            <small>${shopEsc(note)}</small>
        </div>
    `;
}

function shopStockBadge(product) {
    const meta = {
        ok: { label: 'В наличии', className: 'is-ok' },
        low: { label: 'Мало', className: 'is-low' },
        out: { label: 'Нет', className: 'is-out' },
    }[product.stockStatus] || { label: '—', className: '' };
    return `<span class="shop-stock-badge ${meta.className}">${meta.label}</span>`;
}

function shopPaymentOptions(selected = 'kaspi') {
    const methods = window.PAYMENT_METHODS || [];
    return methods.map(method => `
        <option value="${shopEsc(method.value)}" ${method.value === selected ? 'selected' : ''}>
            ${shopEsc(method.label)}
        </option>
    `).join('');
}

function shopFilteredProducts(forSale = false) {
    const search = shopState.productSearch.toLocaleLowerCase('ru');
    return shopState.products.filter(product => {
        if (forSale && (!product.active || product.stockQuantity <= 0)) return false;
        if (shopState.productCategory && product.category !== shopState.productCategory) return false;
        if (shopState.productStock === 'available' && product.stockQuantity <= 0) return false;
        if (shopState.productStock === 'low' && product.stockStatus !== 'low') return false;
        if (shopState.productStock === 'out' && product.stockStatus !== 'out') return false;
        if (!search) return true;
        return [product.name, product.sku, product.barcode, product.category]
            .some(value => String(value || '').toLocaleLowerCase('ru').includes(search));
    });
}

function shopRenderFilters(forSale = false) {
    return `
        <div class="shop-filterbar">
            <label class="shop-search">
                ${shopIcon('search', 17)}
                <input class="admin-input" value="${shopEsc(shopState.productSearch)}"
                    placeholder="Название, артикул или штрихкод"
                    oninput="shopState.productSearch=this.value"
                    onkeydown="if(event.key==='Enter')shopRenderActiveTab()">
            </label>
            <select class="admin-input" onchange="shopState.productCategory=this.value;shopRenderActiveTab()">
                <option value="">Все категории</option>
                ${shopState.categories.map(category => `
                    <option value="${shopEsc(category)}" ${category === shopState.productCategory ? 'selected' : ''}>${shopEsc(category)}</option>
                `).join('')}
            </select>
            ${forSale ? '' : `
                <select class="admin-input" onchange="shopState.productStock=this.value;shopRenderActiveTab()">
                    <option value="all" ${shopState.productStock === 'all' ? 'selected' : ''}>Любой остаток</option>
                    <option value="available" ${shopState.productStock === 'available' ? 'selected' : ''}>В наличии</option>
                    <option value="low" ${shopState.productStock === 'low' ? 'selected' : ''}>Заканчивается</option>
                    <option value="out" ${shopState.productStock === 'out' ? 'selected' : ''}>Нет в наличии</option>
                </select>
            `}
            <button type="button" class="shop-icon-btn" title="Применить фильтр" onclick="shopRenderActiveTab()">
                ${shopIcon('search')}
            </button>
        </div>
    `;
}

function shopCartTotals() {
    let subtotal = 0;
    let cost = 0;
    for (const [productId, quantity] of shopState.cart.entries()) {
        const product = shopState.products.find(item => item.id === productId);
        if (!product) continue;
        subtotal += product.salePrice * quantity;
        cost += (product.purchasePrice || 0) * quantity;
    }
    const discount = Math.max(0, Math.min(Number(shopState.checkout.discountAmount) || 0, subtotal));
    return { subtotal, discount, total: subtotal - discount, cost, margin: subtotal - discount - cost };
}

function shopRenderSaleTab() {
    const products = shopFilteredProducts(true);
    const totals = shopCartTotals();
    const cartItems = [...shopState.cart.entries()].map(([productId, quantity]) => {
        const product = shopState.products.find(item => item.id === productId);
        return product ? { product, quantity } : null;
    }).filter(Boolean);

    return `
        <div class="shop-pos">
            <section class="shop-pos-catalog">
                <div class="shop-block-heading">
                    <div>
                        <span>Каталог</span>
                        <h3>Добавьте товары</h3>
                    </div>
                    <strong>${products.length}</strong>
                </div>
                ${shopRenderFilters(true)}
                <div class="shop-product-grid">
                    ${products.length ? products.map(product => `
                        <button type="button" class="shop-product-tile" onclick="shopAddToCart('${product.id}')">
                            <span class="shop-product-category">${shopEsc(product.category)}</span>
                            <strong>${shopEsc(product.name)}</strong>
                            <small>${shopEsc(product.sku)} · ${shopEsc(product.stockQuantity)} ${shopEsc(product.unit)}</small>
                            <span>${shopMoney(product.salePrice)}</span>
                        </button>
                    `).join('') : `
                        <div class="ops-empty shop-empty-wide">
                            ${shopIcon('box', 28)}
                            <strong>Нет доступных товаров</strong>
                            <span>Измените фильтр или примите товар на склад.</span>
                        </div>
                    `}
                </div>
            </section>

            <aside class="shop-cart">
                <div class="shop-block-heading">
                    <div>
                        <span>Текущая продажа</span>
                        <h3>Корзина</h3>
                    </div>
                    <strong>${cartItems.reduce((sum, item) => sum + item.quantity, 0)}</strong>
                </div>
                <div class="shop-cart-lines">
                    ${cartItems.length ? cartItems.map(({ product, quantity }) => `
                        <div class="shop-cart-line">
                            <div>
                                <strong>${shopEsc(product.name)}</strong>
                                <span>${shopMoney(product.salePrice)} за ${shopEsc(product.unit)}</span>
                            </div>
                            <div class="shop-qty-control">
                                <button type="button" title="Уменьшить" onclick="shopChangeCart('${product.id}',-1)">${shopIcon('minus', 15)}</button>
                                <span>${quantity}</span>
                                <button type="button" title="Добавить" onclick="shopChangeCart('${product.id}',1)">${shopIcon('plus', 15)}</button>
                            </div>
                            <strong>${shopMoney(product.salePrice * quantity)}</strong>
                            <button type="button" class="shop-remove-line" title="Убрать товар" onclick="shopRemoveFromCart('${product.id}')">
                                ${shopIcon('trash', 16)}
                            </button>
                        </div>
                    `).join('') : '<div class="shop-cart-empty">Добавьте товар из каталога слева</div>'}
                </div>

                <div class="shop-checkout-fields">
                    <label>Клиент
                        <input class="admin-input" value="${shopEsc(shopState.checkout.customerName)}"
                            placeholder="Имя, необязательно" oninput="shopSetCheckoutField('customerName',this.value)">
                    </label>
                    <label>Телефон
                        <input class="admin-input" value="${shopEsc(shopState.checkout.customerPhone)}"
                            placeholder="+7..." oninput="shopSetCheckoutField('customerPhone',this.value)">
                    </label>
                    <label>Счёт оплаты
                        <select class="admin-input" onchange="shopSetCheckoutField('paymentMethod',this.value)">
                            ${shopPaymentOptions(shopState.checkout.paymentMethod)}
                        </select>
                    </label>
                    <label>Скидка, ₸
                        <input class="admin-input" type="number" min="0" max="${totals.subtotal}"
                            value="${shopEsc(shopState.checkout.discountAmount || 0)}"
                            oninput="shopSetCheckoutField('discountAmount',this.value);shopUpdateCheckoutTotals()">
                    </label>
                    <label class="shop-field-wide">Комментарий
                        <input class="admin-input" value="${shopEsc(shopState.checkout.notes)}"
                            placeholder="Необязательно" oninput="shopSetCheckoutField('notes',this.value)">
                    </label>
                </div>

                <div class="shop-checkout-total" id="shopCheckoutTotal">
                    ${shopRenderCheckoutTotals(totals)}
                </div>
                <button type="button" class="shop-checkout-btn" ${!cartItems.length || shopState.pending ? 'disabled' : ''}
                    onclick="shopCheckout()">
                    ${shopIcon('check')}
                    <span>${shopState.pending ? 'Проводим продажу...' : `Оформить на ${shopMoney(totals.total)}`}</span>
                </button>
            </aside>
        </div>
    `;
}

function shopRenderCheckoutTotals(totals = shopCartTotals()) {
    return `
        <div><span>Товары</span><strong>${shopMoney(totals.subtotal)}</strong></div>
        <div><span>Скидка</span><strong>−${shopMoney(totals.discount)}</strong></div>
        <div class="is-total"><span>К оплате</span><strong>${shopMoney(totals.total)}</strong></div>
    `;
}

function shopRenderProductsTab() {
    const products = shopFilteredProducts(false);
    const admin = shopCanManageInventory();
    return `
        <div class="shop-table-toolbar">
            ${shopRenderFilters(false)}
            ${admin ? `
                <button type="button" class="btn-primary shop-action-btn" onclick="shopOpenProductModal()">
                    ${shopIcon('plus')}<span>Новый товар</span>
                </button>
            ` : ''}
        </div>
        <div class="table-wrapper shop-table-wrapper">
            <table class="admin-table shop-table">
                <thead>
                    <tr>
                        <th>Товар</th>
                        <th>Категория</th>
                        <th>Остаток</th>
                        ${admin ? '<th>Себестоимость</th>' : ''}
                        <th>Цена</th>
                        ${admin ? '<th>Маржа / ед.</th><th>Действия</th>' : ''}
                    </tr>
                </thead>
                <tbody>
                    ${products.length ? products.map(product => `
                        <tr class="${product.active ? '' : 'is-archived'}">
                            <td data-label="Товар">
                                <div class="shop-product-cell">
                                    <strong>${shopEsc(product.name)}</strong>
                                    <span>${shopEsc(product.sku)}${product.barcode ? ` · ${shopEsc(product.barcode)}` : ''}</span>
                                </div>
                            </td>
                            <td data-label="Категория">${shopEsc(product.category)}</td>
                            <td data-label="Остаток">
                                <div class="shop-stock-cell">
                                    <strong>${shopEsc(product.stockQuantity)} ${shopEsc(product.unit)}</strong>
                                    ${shopStockBadge(product)}
                                    <small>минимум ${shopEsc(product.minimumStock)}</small>
                                </div>
                            </td>
                            ${admin ? `<td data-label="Себестоимость">${shopMoney(product.purchasePrice)}</td>` : ''}
                            <td data-label="Цена"><strong>${shopMoney(product.salePrice)}</strong></td>
                            ${admin ? `
                                <td data-label="Маржа / ед.">
                                    <strong class="${product.marginAmount > 0 ? 'shop-positive' : 'shop-negative'}">${shopMoney(product.marginAmount)}</strong>
                                    <small class="shop-table-note">${product.salePrice ? Math.round(product.marginAmount / product.salePrice * 100) : 0}%</small>
                                </td>
                                <td>
                                    <div class="shop-row-actions">
                                        <button type="button" title="Принять товар" onclick="shopOpenStockModal('receipt','${product.id}')">${shopIcon('receive', 16)}</button>
                                        <button type="button" title="Инвентаризация" onclick="shopOpenStockModal('adjustment','${product.id}')">${shopIcon('adjust', 16)}</button>
                                        <button type="button" title="Списание" onclick="shopOpenStockModal('write-off','${product.id}')">${shopIcon('trash', 16)}</button>
                                        <button type="button" title="Редактировать" onclick="shopOpenProductModal('${product.id}')">${shopIcon('edit', 16)}</button>
                                    </div>
                                </td>
                            ` : ''}
                        </tr>
                    `).join('') : '<tr class="table-message"><td colspan="7">Товары не найдены</td></tr>'}
                </tbody>
            </table>
        </div>
    `;
}

function shopMovementLabel(type) {
    return {
        receipt: 'Приход',
        sale: 'Продажа',
        sale_return: 'Возврат продажи',
        write_off: 'Списание',
        adjustment: 'Инвентаризация',
    }[type] || type;
}

function shopRenderMovementsTab() {
    return `
        <div class="shop-section-heading">
            <div>
                <span>Аудит склада</span>
                <h3>Движения товаров</h3>
            </div>
            <button type="button" class="shop-icon-btn" title="Обновить" onclick="shopLoadMovements(true)">${shopIcon('refresh')}</button>
        </div>
        <div class="table-wrapper shop-table-wrapper">
            <table class="admin-table shop-table">
                <thead>
                    <tr>
                        <th>Дата</th>
                        <th>Товар</th>
                        <th>Операция</th>
                        <th>Изменение</th>
                        <th>Остаток</th>
                        <th>Себестоимость</th>
                        <th>Документ</th>
                        <th>Сотрудник</th>
                        <th>Комментарий</th>
                    </tr>
                </thead>
                <tbody>
                    ${shopState.movements.length ? shopState.movements.map(movement => `
                        <tr>
                            <td data-label="Дата">${shopDate(movement.occurredAt, true)}</td>
                            <td data-label="Товар">
                                <div class="shop-product-cell">
                                    <strong>${shopEsc(movement.product?.name)}</strong>
                                    <span>${shopEsc(movement.product?.sku)}</span>
                                </div>
                            </td>
                            <td data-label="Операция"><span class="shop-movement-type is-${shopEsc(movement.type)}">${shopEsc(shopMovementLabel(movement.type))}</span></td>
                            <td data-label="Изменение"><strong class="${movement.quantity > 0 ? 'shop-positive' : 'shop-negative'}">${movement.quantity > 0 ? '+' : ''}${shopEsc(movement.quantity)} ${shopEsc(movement.product?.unit)}</strong></td>
                            <td data-label="Остаток">${shopEsc(movement.balanceAfter)} ${shopEsc(movement.product?.unit)}</td>
                            <td data-label="Себестоимость">${movement.unitCost == null ? '—' : shopMoney(movement.unitCost)}</td>
                            <td data-label="Документ">${movement.sale ? shopEsc(movement.sale.number) : shopEsc(movement.documentNumber || '—')}</td>
                            <td data-label="Сотрудник">${shopEsc(movement.createdByName)}</td>
                            <td data-label="Комментарий">${shopEsc(movement.reason || movement.supplier || '—')}</td>
                        </tr>
                    `).join('') : '<tr class="table-message"><td colspan="9">Движений пока нет</td></tr>'}
                </tbody>
            </table>
        </div>
    `;
}

function shopSaleItemsLabel(items) {
    const rows = Array.isArray(items) ? items : [];
    const visible = rows.slice(0, 2).map(item => `${item.productName} ×${item.quantity}`).join(', ');
    return rows.length > 2 ? `${visible} +${rows.length - 2}` : visible || '—';
}

function shopRenderSalesTab() {
    const admin = shopCanManageInventory();
    return `
        <div class="shop-table-toolbar">
            <div class="shop-filterbar">
                <label class="shop-search">
                    ${shopIcon('search', 17)}
                    <input class="admin-input" value="${shopEsc(shopState.saleSearch)}" placeholder="Номер, клиент или телефон"
                        oninput="shopState.saleSearch=this.value"
                        onkeydown="if(event.key==='Enter')shopLoadSales(true)">
                </label>
                <select class="admin-input" onchange="shopState.saleStatus=this.value;shopLoadSales(true)">
                    <option value="">Все статусы</option>
                    <option value="completed" ${shopState.saleStatus === 'completed' ? 'selected' : ''}>Проведённые</option>
                    <option value="cancelled" ${shopState.saleStatus === 'cancelled' ? 'selected' : ''}>Отменённые</option>
                </select>
                <button type="button" class="shop-icon-btn" title="Найти" onclick="shopLoadSales(true)">${shopIcon('search')}</button>
            </div>
            <button type="button" class="btn-primary shop-action-btn" onclick="shopSetTab('sale')">
                ${shopIcon('plus')}<span>Новая продажа</span>
            </button>
        </div>
        <div class="table-wrapper shop-table-wrapper">
            <table class="admin-table shop-table">
                <thead>
                    <tr>
                        <th>Продажа</th>
                        <th>Клиент</th>
                        <th>Товары</th>
                        <th>Оплата</th>
                        <th>Выручка</th>
                        ${admin ? '<th>Себестоимость</th><th>Маржа</th>' : ''}
                        <th>Продавец</th>
                        <th>Статус</th>
                        ${admin ? '<th></th>' : ''}
                    </tr>
                </thead>
                <tbody>
                    ${shopState.sales.length ? shopState.sales.map(sale => {
                        const margin = sale.totalAmount - (sale.costAmount || 0);
                        return `
                            <tr class="${sale.status === 'cancelled' ? 'is-cancelled' : ''}">
                                <td data-label="Продажа">
                                    <div class="shop-product-cell">
                                        <strong>${shopEsc(sale.number)}</strong>
                                        <span>${shopDate(sale.saleDate, true)}</span>
                                    </div>
                                </td>
                                <td data-label="Клиент">
                                    <div class="shop-product-cell">
                                        <strong>${shopEsc(sale.customerName || 'Без имени')}</strong>
                                        <span>${shopEsc(sale.customerPhone || '—')}</span>
                                    </div>
                                </td>
                                <td data-label="Товары" class="shop-sale-items">${shopEsc(shopSaleItemsLabel(sale.items))}</td>
                                <td data-label="Оплата">${shopEsc(getPaymentMethodLabel(sale.paymentMethod) || sale.paymentMethod)}</td>
                                <td data-label="Выручка">
                                    <strong>${shopMoney(sale.totalAmount)}</strong>
                                    ${sale.discountAmount ? `<small class="shop-table-note">скидка ${shopMoney(sale.discountAmount)}</small>` : ''}
                                </td>
                                ${admin ? `
                                    <td data-label="Себестоимость">${shopMoney(sale.costAmount)}</td>
                                    <td data-label="Маржа"><strong class="${margin >= 0 ? 'shop-positive' : 'shop-negative'}">${shopMoney(margin)}</strong></td>
                                ` : ''}
                                <td data-label="Продавец">${shopEsc(sale.sellerName || '—')}</td>
                                <td data-label="Статус">
                                    <span class="shop-sale-status is-${shopEsc(sale.status)}">
                                        ${sale.status === 'completed' ? 'Проведена' : 'Отменена'}
                                    </span>
                                    ${sale.cancellationReason ? `<small class="shop-table-note">${shopEsc(sale.cancellationReason)}</small>` : ''}
                                </td>
                                ${admin ? `
                                    <td>
                                        ${sale.status === 'completed' ? `
                                            <button type="button" class="shop-icon-btn is-danger" title="Отменить продажу"
                                                onclick="shopOpenCancelModal('${sale.id}')">${shopIcon('close', 16)}</button>
                                        ` : ''}
                                    </td>
                                ` : ''}
                            </tr>
                        `;
                    }).join('') : '<tr class="table-message"><td colspan="10">Продаж за период нет</td></tr>'}
                </tbody>
            </table>
        </div>
    `;
}

function shopRenderActiveTab() {
    const body = document.getElementById('shopActiveTab');
    if (!body) return;
    if (shopState.tab === 'sale') body.innerHTML = shopRenderSaleTab();
    if (shopState.tab === 'products') body.innerHTML = shopRenderProductsTab();
    if (shopState.tab === 'movements') body.innerHTML = shopRenderMovementsTab();
    if (shopState.tab === 'sales') body.innerHTML = shopRenderSalesTab();
}

function shopRenderShell() {
    const root = document.getElementById('shopRoot');
    if (!root) return;
    const summary = shopState.summary || {};
    const admin = shopCanManageInventory();
    root.innerHTML = `
        <div class="shop-page-header">
            <div>
                <span class="shop-eyebrow">Розничный контур</span>
                <h2>Магазин и склад</h2>
            </div>
            <div class="shop-header-actions">
                ${admin ? `
                    <button type="button" class="btn-secondary shop-action-btn" onclick="shopOpenStockPicker('receipt')">
                        ${shopIcon('receive')}<span>Принять товар</span>
                    </button>
                    <button type="button" class="btn-secondary shop-action-btn" onclick="shopOpenProductModal()">
                        ${shopIcon('plus')}<span>Новый товар</span>
                    </button>
                ` : ''}
                <button type="button" class="btn-primary shop-action-btn" onclick="shopSetTab('sale')">
                    ${shopIcon('cart')}<span>Продажа</span>
                </button>
            </div>
        </div>
        <div class="shop-metrics">
            ${shopSummaryMetric('Товаров', summary.productsCount || 0, `${summary.inventoryUnits || 0} единиц на складе`)}
            ${shopSummaryMetric('Заканчивается', summary.lowStockCount || 0, 'ниже минимального остатка', summary.lowStockCount ? 'warning' : '')}
            ${shopSummaryMetric('Продаж', summary.salesCount || 0, 'за текущий месяц')}
            ${shopSummaryMetric('Выручка', shopMoney(summary.revenue || 0), 'по проведённым продажам', 'revenue')}
            ${admin ? shopSummaryMetric('Валовая маржа', shopMoney(summary.grossProfit || 0), `себестоимость ${shopMoney(summary.cost || 0)}`, 'profit') : ''}
            ${admin ? shopSummaryMetric('Товар в закупке', shopMoney(summary.stockValue || 0), `в рознице ${shopMoney(summary.retailValue || 0)}`) : ''}
        </div>
        <div class="shop-tabs" role="tablist">
            <button type="button" class="${shopState.tab === 'sale' ? 'is-active' : ''}" onclick="shopSetTab('sale')">${shopIcon('cart', 16)}<span>Продажа</span></button>
            <button type="button" class="${shopState.tab === 'products' ? 'is-active' : ''}" onclick="shopSetTab('products')">${shopIcon('products', 16)}<span>Товары</span></button>
            ${admin ? `<button type="button" class="${shopState.tab === 'movements' ? 'is-active' : ''}" onclick="shopSetTab('movements')">${shopIcon('history', 16)}<span>Движения</span></button>` : ''}
            <button type="button" class="${shopState.tab === 'sales' ? 'is-active' : ''}" onclick="shopSetTab('sales')">${shopIcon('history', 16)}<span>Продажи</span></button>
        </div>
        <div id="shopActiveTab" class="shop-tab-content"></div>
    `;
    shopRenderActiveTab();
}

async function renderShop(forceReload = false) {
    const root = document.getElementById('shopRoot');
    if (!root) return;
    if (forceReload || !shopState.products.length) {
        root.innerHTML = '<div class="ops-loading">Загружаем магазин и остатки...</div>';
    }
    try {
        const [summary, products] = await Promise.all([
            shopRequest('/summary'),
            shopRequest('/products?active=all'),
        ]);
        shopState.summary = summary.summary || {};
        shopState.products = products.products || [];
        shopState.categories = products.categories || [];
        shopEnsureModal();
        shopRenderShell();
        if (shopState.tab === 'movements') await shopLoadMovements();
        if (shopState.tab === 'sales') await shopLoadSales();
    } catch (error) {
        root.innerHTML = `<div class="ops-empty is-error">${shopEsc(error.message)}</div>`;
    }
}

async function shopSetTab(tab) {
    if (tab === 'movements' && !shopCanManageInventory()) return;
    shopState.tab = tab;
    shopRenderShell();
    if (tab === 'movements') await shopLoadMovements();
    if (tab === 'sales') await shopLoadSales();
}

function shopSetCheckoutField(field, value) {
    shopState.checkout[field] = value;
}

function shopUpdateCheckoutTotals() {
    const target = document.getElementById('shopCheckoutTotal');
    if (target) target.innerHTML = shopRenderCheckoutTotals();
    const button = document.querySelector('.shop-checkout-btn span');
    if (button && !shopState.pending) button.textContent = `Оформить на ${shopMoney(shopCartTotals().total)}`;
}

function shopAddToCart(productId) {
    const product = shopState.products.find(item => item.id === productId);
    if (!product) return;
    const next = (shopState.cart.get(productId) || 0) + 1;
    if (next > product.stockQuantity) {
        toast.warning(`На складе только ${product.stockQuantity} ${product.unit}`);
        return;
    }
    shopState.cart.set(productId, next);
    shopRenderActiveTab();
}

function shopChangeCart(productId, delta) {
    const product = shopState.products.find(item => item.id === productId);
    if (!product) return;
    const next = (shopState.cart.get(productId) || 0) + delta;
    if (next <= 0) shopState.cart.delete(productId);
    else if (next <= product.stockQuantity) shopState.cart.set(productId, next);
    else toast.warning(`На складе только ${product.stockQuantity} ${product.unit}`);
    shopRenderActiveTab();
}

function shopRemoveFromCart(productId) {
    shopState.cart.delete(productId);
    shopRenderActiveTab();
}

async function shopCheckout() {
    if (shopState.pending || !shopState.cart.size) return;
    const totals = shopCartTotals();
    if (totals.total <= 0) return toast.warning('Проверьте сумму продажи');
    shopState.pending = true;
    shopRenderActiveTab();
    try {
        const idempotencyKey = window.crypto?.randomUUID?.()
            || `shop-sale-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const result = await shopRequest('/sales', {
            method: 'POST',
            idempotencyKey,
            body: JSON.stringify({
                items: [...shopState.cart.entries()].map(([productId, quantity]) => ({ productId, quantity })),
                customerName: shopState.checkout.customerName,
                customerPhone: shopState.checkout.customerPhone,
                paymentMethod: shopState.checkout.paymentMethod,
                discountAmount: Number(shopState.checkout.discountAmount) || 0,
                notes: shopState.checkout.notes,
            }),
        });
        shopState.cart.clear();
        shopState.checkout = {
            customerName: '',
            customerPhone: '',
            paymentMethod: 'kaspi',
            discountAmount: 0,
            notes: '',
        };
        toast.success(`Продажа ${result.sale.number} проведена`);
        await renderShop(true);
    } catch (error) {
        toast.error(error.message);
    } finally {
        shopState.pending = false;
        shopRenderActiveTab();
    }
}

async function shopLoadMovements(force = false) {
    const body = document.getElementById('shopActiveTab');
    if (force && body) body.innerHTML = '<div class="ops-loading">Загружаем движения...</div>';
    try {
        const result = await shopRequest('/movements?limit=250');
        shopState.movements = result.movements || [];
        if (shopState.tab === 'movements') shopRenderActiveTab();
    } catch (error) {
        if (body) body.innerHTML = `<div class="ops-empty is-error">${shopEsc(error.message)}</div>`;
    }
}

async function shopLoadSales(force = false) {
    const body = document.getElementById('shopActiveTab');
    if (force && body) body.innerHTML = '<div class="ops-loading">Загружаем продажи...</div>';
    try {
        const params = new URLSearchParams({ limit: '250' });
        if (shopState.saleSearch) params.set('search', shopState.saleSearch);
        if (shopState.saleStatus) params.set('status', shopState.saleStatus);
        const result = await shopRequest(`/sales?${params}`);
        shopState.sales = result.sales || [];
        if (shopState.tab === 'sales') shopRenderActiveTab();
    } catch (error) {
        if (body) body.innerHTML = `<div class="ops-empty is-error">${shopEsc(error.message)}</div>`;
    }
}

function shopEnsureModal() {
    if (document.getElementById('shopModal')) return;
    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal shop-modal" id="shopModal" aria-hidden="true">
            <div class="modal-overlay" onclick="shopCloseModal()"></div>
            <div class="modal-content shop-modal-content">
                <button type="button" class="modal-close" onclick="shopCloseModal()" aria-label="Закрыть">${shopIcon('close')}</button>
                <div id="shopModalBody"></div>
            </div>
        </div>
    `);
}

function shopOpenModal(content) {
    shopEnsureModal();
    const modal = document.getElementById('shopModal');
    const body = document.getElementById('shopModalBody');
    body.innerHTML = content;
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
}

function shopCloseModal() {
    const modal = document.getElementById('shopModal');
    modal?.classList.remove('show');
    modal?.setAttribute('aria-hidden', 'true');
}

function shopOpenProductModal(productId = '') {
    const product = productId ? shopState.products.find(item => item.id === productId) : null;
    shopOpenModal(`
        <div class="shop-modal-heading">
            <span>${product ? 'Карточка товара' : 'Новая позиция'}</span>
            <h3>${product ? 'Редактировать товар' : 'Добавить товар'}</h3>
        </div>
        <form class="shop-form" onsubmit="shopSubmitProduct(event,'${shopEsc(productId)}')">
            <label class="shop-field-wide">Название *
                <input class="admin-input" name="name" required maxlength="180" value="${shopEsc(product?.name || '')}">
            </label>
            <label>Артикул
                <input class="admin-input" name="sku" maxlength="80" value="${shopEsc(product?.sku || '')}" placeholder="Сгенерируется автоматически">
            </label>
            <label>Штрихкод
                <input class="admin-input" name="barcode" maxlength="120" value="${shopEsc(product?.barcode || '')}">
            </label>
            <label>Категория
                <input class="admin-input" name="category" list="shopCategoryList" maxlength="120" value="${shopEsc(product?.category || '')}" placeholder="Например, струны">
                <datalist id="shopCategoryList">${shopState.categories.map(item => `<option value="${shopEsc(item)}"></option>`).join('')}</datalist>
            </label>
            <label>Единица
                <input class="admin-input" name="unit" maxlength="30" value="${shopEsc(product?.unit || 'шт.')}">
            </label>
            <label>Себестоимость, ₸
                <input class="admin-input" name="purchasePrice" type="number" min="0" step="1" value="${shopEsc(product?.purchasePrice || 0)}">
            </label>
            <label>Цена продажи, ₸ *
                <input class="admin-input" name="salePrice" type="number" min="1" step="1" required value="${shopEsc(product?.salePrice || '')}">
            </label>
            <label>Минимальный остаток
                <input class="admin-input" name="minimumStock" type="number" min="0" step="1" value="${shopEsc(product?.minimumStock || 0)}">
            </label>
            ${product ? '' : `
                <label>Начальный остаток
                    <input class="admin-input" name="initialStock" type="number" min="0" step="1" value="0">
                </label>
            `}
            <label class="shop-field-wide">Описание
                <textarea class="admin-input" name="description" rows="3">${shopEsc(product?.description || '')}</textarea>
            </label>
            ${product ? `
                <label class="shop-toggle-field shop-field-wide">
                    <input type="checkbox" name="active" ${product.active ? 'checked' : ''}>
                    <span>Товар активен и доступен для продажи</span>
                </label>
            ` : ''}
            <div class="shop-form-actions shop-field-wide">
                <button type="button" class="btn-secondary" onclick="shopCloseModal()">Отмена</button>
                <button type="submit" class="btn-primary">${product ? 'Сохранить' : 'Создать товар'}</button>
            </div>
        </form>
    `);
}

async function shopSubmitProduct(event, productId = '') {
    event.preventDefault();
    if (shopState.pending) return;
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    if (productId) data.active = form.elements.active.checked;
    shopState.pending = true;
    form.querySelector('button[type="submit"]').disabled = true;
    try {
        await shopRequest(productId ? `/products/${productId}` : '/products', {
            method: productId ? 'PATCH' : 'POST',
            body: JSON.stringify(data),
        });
        shopCloseModal();
        toast.success(productId ? 'Товар обновлён' : 'Товар создан');
        await renderShop(true);
        shopState.tab = 'products';
        shopRenderShell();
    } catch (error) {
        toast.error(error.message);
    } finally {
        shopState.pending = false;
        if (form.isConnected) form.querySelector('button[type="submit"]').disabled = false;
    }
}

function shopOpenStockPicker(mode = 'receipt') {
    const products = shopState.products.filter(product => product.active);
    if (!products.length) return toast.warning('Сначала создайте товар');
    shopOpenModal(`
        <div class="shop-modal-heading">
            <span>Склад</span>
            <h3>${mode === 'receipt' ? 'Принять товар' : 'Выбрать товар'}</h3>
        </div>
        <div class="shop-picker-list">
            ${products.map(product => `
                <button type="button" onclick="shopOpenStockModal('${shopEsc(mode)}','${product.id}')">
                    <span><strong>${shopEsc(product.name)}</strong><small>${shopEsc(product.sku)} · остаток ${shopEsc(product.stockQuantity)} ${shopEsc(product.unit)}</small></span>
                    ${shopIcon('receive')}
                </button>
            `).join('')}
        </div>
    `);
}

function shopOpenStockModal(mode, productId) {
    const product = shopState.products.find(item => item.id === productId);
    if (!product) return toast.error('Товар не найден');
    const isReceipt = mode === 'receipt';
    const isAdjustment = mode === 'adjustment';
    const title = isReceipt ? 'Приёмка товара' : isAdjustment ? 'Инвентаризация' : 'Списание товара';
    shopOpenModal(`
        <div class="shop-modal-heading">
            <span>${shopEsc(product.name)} · ${shopEsc(product.sku)}</span>
            <h3>${title}</h3>
            <p>Учётный остаток: <strong>${shopEsc(product.stockQuantity)} ${shopEsc(product.unit)}</strong></p>
        </div>
        <form class="shop-form" onsubmit="shopSubmitStock(event,'${shopEsc(mode)}','${product.id}')">
            ${isReceipt ? `
                <label>Количество *
                    <input class="admin-input" name="quantity" type="number" min="1" step="1" required>
                </label>
                <label>Себестоимость единицы, ₸ *
                    <input class="admin-input" name="unitCost" type="number" min="0" step="1" required value="${shopEsc(product.purchasePrice || 0)}">
                </label>
                <label>Поставщик
                    <input class="admin-input" name="supplier" maxlength="180">
                </label>
                <label>Номер документа
                    <input class="admin-input" name="documentNumber" maxlength="120">
                </label>
                <label>Счёт оплаты
                    <select class="admin-input" name="paymentMethod">${shopPaymentOptions('cash')}</select>
                </label>
                <label>Дата
                    <input class="admin-input" name="occurredAt" type="date" value="${shopLocalDateInput()}">
                </label>
                <label class="shop-toggle-field shop-field-wide">
                    <input type="checkbox" name="recordExpense" checked>
                    <span>Записать закупку расходом в кассу</span>
                </label>
                <label class="shop-field-wide">Комментарий
                    <textarea class="admin-input" name="reason" rows="2" placeholder="Партия, условия поставки"></textarea>
                </label>
            ` : isAdjustment ? `
                <label>Фактический остаток *
                    <input class="admin-input" name="actualQuantity" type="number" min="0" step="1" required value="${shopEsc(product.stockQuantity)}">
                </label>
                <label>Дата
                    <input class="admin-input" name="occurredAt" type="date" value="${shopLocalDateInput()}">
                </label>
                <label class="shop-field-wide">Причина *
                    <textarea class="admin-input" name="reason" rows="3" required placeholder="Например, пересчёт склада"></textarea>
                </label>
            ` : `
                <label>Количество *
                    <input class="admin-input" name="quantity" type="number" min="1" max="${shopEsc(product.stockQuantity)}" step="1" required>
                </label>
                <label>Дата
                    <input class="admin-input" name="occurredAt" type="date" value="${shopLocalDateInput()}">
                </label>
                <label class="shop-field-wide">Причина *
                    <textarea class="admin-input" name="reason" rows="3" required placeholder="Брак, повреждение, использование школой"></textarea>
                </label>
            `}
            <div class="shop-form-actions shop-field-wide">
                <button type="button" class="btn-secondary" onclick="shopCloseModal()">Отмена</button>
                <button type="submit" class="btn-primary">${isReceipt ? 'Принять на склад' : isAdjustment ? 'Зафиксировать остаток' : 'Списать'}</button>
            </div>
        </form>
    `);
}

async function shopSubmitStock(event, mode, productId) {
    event.preventDefault();
    if (shopState.pending) return;
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    data.productId = productId;
    if (mode === 'receipt') data.recordExpense = form.elements.recordExpense.checked;
    shopState.pending = true;
    form.querySelector('button[type="submit"]').disabled = true;
    try {
        await shopRequest(`/stock/${mode}`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
        shopCloseModal();
        toast.success(mode === 'receipt' ? 'Товар принят на склад' : mode === 'adjustment' ? 'Остаток скорректирован' : 'Товар списан');
        await renderShop(true);
        shopState.tab = 'products';
        shopRenderShell();
    } catch (error) {
        toast.error(error.message);
    } finally {
        shopState.pending = false;
        if (form.isConnected) form.querySelector('button[type="submit"]').disabled = false;
    }
}

function shopOpenCancelModal(saleId) {
    const sale = shopState.sales.find(item => item.id === saleId);
    if (!sale) return;
    shopOpenModal(`
        <div class="shop-modal-heading">
            <span>${shopEsc(sale.number)}</span>
            <h3>Отменить продажу</h3>
            <p>Товар вернётся на склад, а в кассе появится расход на ${shopMoney(sale.totalAmount)}.</p>
        </div>
        <form class="shop-form" onsubmit="shopSubmitCancel(event,'${sale.id}')">
            <label class="shop-field-wide">Причина отмены *
                <textarea class="admin-input" name="reason" rows="4" required placeholder="Ошибка кассира, возврат покупателя"></textarea>
            </label>
            <div class="shop-form-actions shop-field-wide">
                <button type="button" class="btn-secondary" onclick="shopCloseModal()">Оставить продажу</button>
                <button type="submit" class="btn-primary shop-danger-btn">Отменить и вернуть товар</button>
            </div>
        </form>
    `);
}

async function shopSubmitCancel(event, saleId) {
    event.preventDefault();
    if (shopState.pending) return;
    const form = event.currentTarget;
    shopState.pending = true;
    form.querySelector('button[type="submit"]').disabled = true;
    try {
        const result = await shopRequest(`/sales/${saleId}/cancel`, {
            method: 'POST',
            body: JSON.stringify({ reason: form.elements.reason.value }),
        });
        shopCloseModal();
        toast.success(result.message);
        await renderShop(true);
        shopState.tab = 'sales';
        shopRenderShell();
        await shopLoadSales();
    } catch (error) {
        toast.error(error.message);
    } finally {
        shopState.pending = false;
        if (form.isConnected) form.querySelector('button[type="submit"]').disabled = false;
    }
}

window.shopState = shopState;
window.renderShop = renderShop;
window.shopSetTab = shopSetTab;
window.shopRenderActiveTab = shopRenderActiveTab;
window.shopSetCheckoutField = shopSetCheckoutField;
window.shopUpdateCheckoutTotals = shopUpdateCheckoutTotals;
window.shopAddToCart = shopAddToCart;
window.shopChangeCart = shopChangeCart;
window.shopRemoveFromCart = shopRemoveFromCart;
window.shopCheckout = shopCheckout;
window.shopLoadMovements = shopLoadMovements;
window.shopLoadSales = shopLoadSales;
window.shopOpenProductModal = shopOpenProductModal;
window.shopSubmitProduct = shopSubmitProduct;
window.shopOpenStockPicker = shopOpenStockPicker;
window.shopOpenStockModal = shopOpenStockModal;
window.shopSubmitStock = shopSubmitStock;
window.shopOpenCancelModal = shopOpenCancelModal;
window.shopSubmitCancel = shopSubmitCancel;
window.shopCloseModal = shopCloseModal;
