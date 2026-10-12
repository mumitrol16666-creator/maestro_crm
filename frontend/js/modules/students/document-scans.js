(() => {
    const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const date = value => new Date(value).toLocaleString('ru-RU', { timeZone: 'Asia/Aqtobe' });
    const size = value => `${(value / 1024 / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} МБ`;
    let current = null;
    window.openDocumentScans = async (scope, documentId) => {
        if (current) return;
        const opener = document.activeElement, parent = opener?.closest('.modal');
        const root = document.createElement('div'); root.className = 'modal show enrollment-modal document-scans-modal'; root.id = 'documentScansModal';
        root.innerHTML = `<div class="modal-overlay" data-close></div><section class="modal-content enrollment-dialog" role="dialog" aria-modal="true" aria-labelledby="scanTitle"><header><h2 id="scanTitle">Сканы документов</h2><button type="button" class="admin-btn btn-secondary" data-close aria-label="Закрыть сканы">×</button></header><div class="enrollment-error" role="alert" hidden></div><p role="status" data-status></p><div data-content>Загрузка…</div></section>`;
        let state, busy = false;
        current = root; if (parent) parent.inert = true; document.body.append(root);
        const path = `/document-scans/${encodeURIComponent(scope)}/${encodeURIComponent(documentId)}`;
        function error(message) { const box = root.querySelector('[role=alert]'); box.textContent = message; box.hidden = false; }
        async function request(suffix = '', options = {}) {
            // The generic mutation cache gives all multipart bodies the same key.
            // File retries are deduplicated by content on the server instead.
            const send = options.body instanceof FormData ? nativeFetch : fetch;
            const response = await send(`${API_URL}${path}${suffix}`, { ...options, headers: { Authorization: `Bearer ${getAuthToken()}`, ...options.headers } });
            if (!response.ok) {
                let data; try { data = await response.json(); } catch {}
                throw new Error(data?.error || (response.status === 413 ? 'Файл слишком большой: не больше 8 МБ.' : 'Не удалось выполнить действие. Обновите список перед повтором.'));
            }
            return response;
        }
        async function reload() { state = await (await request()).json(); if (root.isConnected) render(); }
        async function action(fn) {
            if (busy) return; busy = true; root.querySelector('[role=alert]').hidden = true;
            const controls = [...root.querySelectorAll('button,input,select')].filter(el => !el.disabled); controls.forEach(el => el.disabled = true);
            try { await fn(); }
            catch (err) { error(err.message); }
            finally { busy = false; controls.filter(el => el.isConnected).forEach(el => el.disabled = false); }
        }
        function close() {
            if (busy) return; root.remove(); current = null; if (parent) parent.inert = false; if (opener?.isConnected) opener.focus();
        }
        root.querySelectorAll('[data-close]').forEach(el => el.onclick = close);
        root.onkeydown = event => {
            if (event.key === 'Escape') { event.stopPropagation(); close(); }
            if (event.key === 'Tab') {
                const items = [...root.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')].filter(el => el.offsetParent !== null);
                if (event.shiftKey && document.activeElement === items[0]) { items.at(-1)?.focus(); event.preventDefault(); }
                if (!event.shiftKey && document.activeElement === items.at(-1)) { items[0]?.focus(); event.preventDefault(); }
            }
        };
        function render() {
            root.querySelector('#scanTitle').textContent = `Сканы — ${state.title}`;
            root.querySelector('[data-content]').innerHTML = `<p>PDF, JPEG или PNG, до 8 МБ на файл. Можно выбрать несколько фото страниц. Загрузка не отмечает подпись: её администратор подтверждает отдельно.</p>${state.canUpload ? `<form data-upload><label class="enrollment-field">К какому документу относится скан<select class="admin-input" name="kind">${Object.entries(state.kinds).map(([key, label]) => `<option value="${key}">${h(label)}</option>`).join('')}</select></label><label class="enrollment-field">Файлы со сканом<input class="admin-input" type="file" name="files" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" multiple required></label><button class="admin-btn btn-primary" type="submit">Загрузить сканы</button></form>` : '<p class="enrollment-notice">Расчёт отменён. Здесь сохраняется история ранее загруженных сканов.</p>'}<h3>Сохранённые сканы</h3>${state.files.length ? state.files.map(file => `<section class="enrollment-account"><h4 class="scan-filename">${h(file.fileName)}</h4><p>${h(state.kinds[file.kind])} · ${size(file.size)} · ${date(file.createdAt)}</p>${file.reviewReason ? `<p>${file.withdrawnAt ? 'Отмечен ошибочным' : 'Восстановлен'}: ${h(file.reviewReason)}</p>` : ''}<div class="enrollment-actions"><button type="button" class="admin-btn btn-secondary" data-download="${h(file.id)}">${file.withdrawnAt ? 'Скачать ошибочный скан для проверки' : 'Скачать скан'}</button><button type="button" class="admin-btn btn-secondary" data-review="${h(file.id)}">${file.withdrawnAt ? 'Восстановить…' : 'Отметить ошибочным…'}</button></div></section>`).join('') : '<p>Сканы пока не загружены.</p>'}<div data-review-form></div><div class="enrollment-actions"><button type="button" class="admin-btn btn-secondary" data-refresh>Обновить список</button></div>`;
            root.querySelector('[data-refresh]').onclick = () => action(reload);
            root.querySelector('[data-upload]')?.addEventListener('submit', event => {
                event.preventDefault(); if (busy) return;
                const form = event.target, files = [...form.elements.files.files], kind = form.elements.kind.value;
                if (files.some(file => file.size > 8 * 1024 * 1024)) { error('Один из файлов больше 8 МБ. Уменьшите его размер перед загрузкой.'); return; }
                action(async () => {
                    let saved = 0, failure;
                    for (const file of files) {
                        root.querySelector('[data-status]').textContent = `Загрузка ${saved + 1} из ${files.length}: ${file.name}`;
                        const body = new FormData(); body.append('kind', kind); body.append('file', file);
                        try { await request('', { method: 'POST', body }); saved++; }
                        catch (err) { failure = `${file.name}: ${err.message}`; break; }
                    }
                    root.querySelector('[data-status]').textContent = `Сохранено ${saved} из ${files.length}. Повторная загрузка того же файла не создаёт копию.`;
                    await reload();
                    if (failure) throw new Error(`${failure} Уже сохранённые файлы остались в списке. Выберите остальные и повторите загрузку.`);
                });
            });
            root.querySelectorAll('[data-download]').forEach(button => button.onclick = () => action(async () => {
                const file = state.files.find(f => f.id === button.dataset.download);
                const blob = await (await request(`/${file.id}/file${file.withdrawnAt ? '?review=1' : ''}`)).blob();
                const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = file.withdrawnAt ? `ОШИБОЧНЫЙ-для-проверки-${file.fileName}` : file.fileName;
                document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
            }));
            root.querySelectorAll('[data-review]').forEach(button => button.onclick = () => {
                if (busy) return;
                const file = state.files.find(f => f.id === button.dataset.review), target = root.querySelector('[data-review-form]');
                target.innerHTML = `<form><h3>${file.withdrawnAt ? 'Восстановить скан' : 'Отметить скан ошибочным'}</h3><p class="scan-filename">${h(file.fileName)}</p><p>Оригинал и история действий сохранятся. Подписи, условия и оплаты не изменятся.</p><label class="enrollment-field">Причина<input class="admin-input" name="reason" required minlength="5" maxlength="1000"></label><label class="enrollment-check"><input type="checkbox" name="confirmed" required> Файл проверен, подтверждаю действие</label><button type="submit" class="admin-btn btn-primary">Подтвердить</button></form>`;
                target.querySelector('form').onsubmit = event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.target)); action(async () => {
                    await request(`/${file.id}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: file.withdrawnAt ? 'restore' : 'withdraw', version: file.reviewVersion, confirmed: Boolean(values.confirmed), reason: values.reason }) });
                    await reload();
                }); };
                target.scrollIntoView({ block: 'start' }); target.querySelector('input').focus();
            });
        }
        root.querySelector('button[data-close]').focus();
        try { await reload(); } catch (err) { if (root.isConnected) error(err.message); }
    };
})();
