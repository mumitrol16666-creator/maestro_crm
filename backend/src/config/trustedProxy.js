function configureTrustedProxy(app, hops = process.env.CRM_TRUST_PROXY_HOPS) {
    if (hops !== undefined && hops !== '1') throw new Error('CRM_TRUST_PROXY_HOPS must be 1 or unset');
    // Docker publishes the backend only on host loopback. Its nginx is the
    // single network hop and appends the real client as the rightmost XFF item.
    // PM2 nginx connects over loopback; other direct peers stay untrusted.
    app.set('trust proxy', hops === '1' ? 1 : 'loopback');
}

module.exports = { configureTrustedProxy };
