class CrmClient {
    constructor(config) {
        this.baseUrl = `${config.crmUrl}/api/internal/whatsapp-browser`;
        this.headers = {
            Authorization: `Bearer ${config.secret}`,
            'X-Whatsapp-Worker-Id': config.workerId,
            'Content-Type': 'application/json',
        };
    }

    async request(path, options = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch(`${this.baseUrl}${path}`, {
                ...options,
                headers: { ...this.headers, ...(options.headers || {}) },
                signal: controller.signal,
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(`CRM ${response.status}: ${data.error || 'request failed'}`);
            return data;
        } finally {
            clearTimeout(timeout);
        }
    }

    heartbeat(payload) {
        return this.request('/heartbeat', { method: 'POST', body: JSON.stringify(payload) });
    }

    importMessages(accountKey, messages) {
        return this.request('/messages/import', {
            method: 'POST',
            body: JSON.stringify({ accountKey, messages }),
            headers: { 'X-Idempotency-Key': `wa-import-${accountKey}-${Date.now()}` },
        });
    }
}

module.exports = { CrmClient };
