// =====================================================
// Phase 2: модалки для причин потери и возврата
// Экспортирует:
//   - openLossReasonDialog({ withStage, reasons? }) -> Promise<{reason, stage?} | null>
//   - openRecoveryDialog() -> Promise<{ note: string | null } | null>
//   - closePhase2Modal()
// =====================================================
(function () {
    const DEFAULT_BOOKING_REASONS = [
        'Дорого',
        'Не подходит расписание',
        'Не отвечает / не дозвонились',
        'Не подошло направление',
        'Ушли к конкурентам',
        'Передумал / подумает',
        'Далеко ехать',
        'Другое',
    ];

    const DEFAULT_STUDENT_REASONS = [
        'Потерял интерес',
        'Переехал',
        'Финансовые трудности',
        'Не подошло расписание',
        'Не подошёл преподаватель',
        'Ушёл к конкурентам',
        'Здоровье',
        'Другое',
    ];

    const STAGE_OPTIONS = [
        { k: 'before_trial', v: 'До пробного' },
        { k: 'on_trial',     v: 'На пробном' },
        { k: 'after_trial',  v: 'После пробного' },
    ];

    let currentResolve = null;

    function openPhase2Modal(opts) {
        const modal = document.getElementById('phase2Modal');
        if (!modal) return Promise.resolve(null);
        const titleEl = document.getElementById('phase2ModalTitle');
        const bodyEl = document.getElementById('phase2ModalBody');
        const formEl = document.getElementById('phase2ModalForm');
        const submitEl = document.getElementById('phase2ModalSubmit');

        titleEl.textContent = opts.title || 'Укажите детали';
        bodyEl.innerHTML = opts.bodyHtml || '';
        submitEl.textContent = opts.submitLabel || 'Сохранить';

        formEl.onsubmit = (e) => {
            e.preventDefault();
            try {
                const result = opts.onSubmit ? opts.onSubmit(formEl) : null;
                if (result === false) return;
                closePhase2Modal(result);
            } catch (err) {
                console.error(err);
            }
        };

        modal.classList.add('show');
        // Фокус на первое поле
        setTimeout(() => {
            const first = bodyEl.querySelector('select,input,textarea');
            if (first) first.focus();
        }, 60);

        return new Promise((resolve) => { currentResolve = resolve; });
    }

    function closePhase2Modal(result) {
        const modal = document.getElementById('phase2Modal');
        if (modal) modal.classList.remove('show');
        if (currentResolve) {
            const r = currentResolve;
            currentResolve = null;
            r(typeof result === 'undefined' ? null : result);
        }
    }

    function escapeHtmlP2(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function buildReasonSelect(id, reasons) {
        const opts = reasons.map(r => `<option value="${escapeHtmlP2(r)}">${escapeHtmlP2(r)}</option>`).join('');
        return `<select id="${id}" class="admin-input" required>${opts}</select>`;
    }

    function buildStageSelect(id) {
        const opts = STAGE_OPTIONS.map(s => `<option value="${s.k}">${escapeHtmlP2(s.v)}</option>`).join('');
        return `<select id="${id}" class="admin-input" required>${opts}</select>`;
    }

    // Диалог причины потери (для бронирований — с этапом; для студентов — без)
    function openLossReasonDialog(opts = {}) {
        const {
            title = 'Причина потери',
            withStage = false,
            reasons = withStage ? DEFAULT_BOOKING_REASONS : DEFAULT_STUDENT_REASONS,
            allowCustom = true,
            initialReason = '',
            initialStage = 'before_trial',
        } = opts;

        const bodyHtml = `
            <div class="form-group">
                <label>Причина</label>
                ${buildReasonSelect('phase2ReasonSel', reasons)}
            </div>
            ${allowCustom ? `
                <div class="form-group">
                    <label>Свой вариант (необязательно)</label>
                    <input type="text" id="phase2ReasonCustom" class="admin-input" placeholder="Опишите причину своими словами" maxlength="200">
                </div>
            ` : ''}
            ${withStage ? `
                <div class="form-group">
                    <label>Этап потери</label>
                    ${buildStageSelect('phase2StageSel')}
                </div>
            ` : ''}
        `;

        return openPhase2Modal({
            title,
            bodyHtml,
            submitLabel: 'Сохранить',
            onSubmit: () => {
                const sel = document.getElementById('phase2ReasonSel');
                const custom = document.getElementById('phase2ReasonCustom');
                const stageSel = document.getElementById('phase2StageSel');
                const customVal = custom && custom.value.trim() ? custom.value.trim() : '';
                const reason = customVal || sel.value;
                if (!reason) { alert('Укажите причину'); return false; }
                const out = { reason };
                if (withStage && stageSel) out.stage = stageSel.value;
                return out;
            },
        }).then((r) => {
            if (!r) return null;
            // Предустановить значения (если хотелось бы; не обязательно)
            return r;
        });
    }

    // Диалог возврата потеряшки — только заметка
    function openRecoveryDialog(opts = {}) {
        const { title = 'Возврат потеряшки' } = opts;
        const bodyHtml = `
            <div class="form-group">
                <label>Комментарий к возврату (необязательно)</label>
                <textarea id="phase2RecoveryNote" class="admin-input" rows="3" placeholder="Как удалось вернуть, канал, что помогло" maxlength="500"></textarea>
            </div>
        `;
        return openPhase2Modal({
            title,
            bodyHtml,
            submitLabel: 'Вернуть',
            onSubmit: () => {
                const ta = document.getElementById('phase2RecoveryNote');
                const note = ta ? ta.value.trim() : '';
                return { note: note || null };
            },
        });
    }

    window.openLossReasonDialog = openLossReasonDialog;
    window.openRecoveryDialog = openRecoveryDialog;
    window.closePhase2Modal = closePhase2Modal;
})();
