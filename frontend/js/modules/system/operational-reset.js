(() => {
    const CONFIRMATION_PHRASE = 'ОЧИСТИТЬ MAESTRO';
    let previewLoaded = false;

    const formatNumber = (value) => new Intl.NumberFormat('ru-RU').format(Number(value || 0));

    function openModal() {
        const modal = document.getElementById('operationalResetModal');
        const input = document.getElementById('operationalResetConfirmation');
        if (!modal || !previewLoaded) return;
        input.value = '';
        document.getElementById('submitOperationalReset').disabled = true;
        modal.classList.add('show');
        input.focus();
    }

    function closeModal() {
        document.getElementById('operationalResetModal')?.classList.remove('show');
    }

    function renderPreview(preview) {
        const deleted = preview.deleted;
        const preserved = preview.preserved;
        const reset = preview.reset;
        const container = document.getElementById('operationalResetPreview');

        container.innerHTML = `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(185px, 1fr)); gap: 10px;">
                <div style="padding: 14px; border-radius: 8px; background: rgba(220,53,69,.12);">
                    <strong>Будет удалено</strong><br>
                    Абонементов: ${formatNumber(deleted.memberships)}<br>
                    Оплат: ${formatNumber(deleted.payments)}<br>
                    Операций кассы: ${formatNumber(deleted.cashTransactions)}<br>
                    Занятий: ${formatNumber(deleted.classes)}<br>
                    Групп: ${formatNumber(deleted.groups)}
                </div>
                <div style="padding: 14px; border-radius: 8px; background: rgba(220,53,69,.12);">
                    <strong>Также очистится</strong><br>
                    Расписаний: ${formatNumber(deleted.studentSchedules + deleted.groupSchedules)}<br>
                    Связей с группами: ${formatNumber(deleted.studentGroups)}<br>
                    Заморозок: ${formatNumber(deleted.freezes)}<br>
                    Зарплат: ${formatNumber(deleted.salaries)}<br>
                    Балансов: ${formatNumber(reset.studentsWithBalance)}<br>
                    Логов интеграции: ${formatNumber(deleted.integrationLogs)}<br>
                    Ключей идемпотентности: ${formatNumber(deleted.idempotencyKeys)}
                </div>
                <div style="padding: 14px; border-radius: 8px; background: rgba(40,167,69,.12);">
                    <strong>Будет сохранено</strong><br>
                    Аккаунтов: ${formatNumber(preserved.users)}<br>
                    Активных учеников: ${formatNumber(preserved.activeStudents)}<br>
                    Заявок: ${formatNumber(preserved.bookings)}<br>
                    Настройки и справочники
                </div>
            </div>
        `;
        container.style.display = 'block';
        previewLoaded = true;
        document.getElementById('openOperationalResetModal').disabled = false;
    }

    async function loadPreview() {
        const button = document.getElementById('loadOperationalResetPreview');
        button.disabled = true;
        button.textContent = 'Проверяю...';
        try {
            const response = await apiRequest('/admin/operational-reset/preview');
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Не удалось проверить данные');
            renderPreview(data.preview);
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            button.disabled = false;
            button.textContent = 'Обновить проверку';
        }
    }

    async function submitReset() {
        const button = document.getElementById('submitOperationalReset');
        button.disabled = true;
        button.textContent = 'Создаю копию и очищаю...';

        try {
            const response = await apiRequest('/admin/operational-reset', {
                method: 'POST',
                body: JSON.stringify({ confirmation: CONFIRMATION_PHRASE }),
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Очистка не выполнена');

            closeModal();
            previewLoaded = false;
            document.getElementById('openOperationalResetModal').disabled = true;
            showToast('CRM очищена. Резервная копия создана, аккаунты и заявки сохранены.', 'success', 12000);
            await loadPreview();
        } catch (error) {
            showToast(error.message, 'error', 12000);
        } finally {
            button.textContent = 'Создать копию и очистить';
            const input = document.getElementById('operationalResetConfirmation');
            button.disabled = input.value !== CONFIRMATION_PHRASE;
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (!isSuperAdmin()) return;

        const card = document.getElementById('operationalResetCard');
        card.style.display = 'block';

        document.getElementById('loadOperationalResetPreview').addEventListener('click', loadPreview);
        document.getElementById('openOperationalResetModal').addEventListener('click', openModal);
        document.getElementById('closeOperationalResetModal').addEventListener('click', closeModal);
        document.getElementById('cancelOperationalReset').addEventListener('click', closeModal);
        document.getElementById('operationalResetModalOverlay').addEventListener('click', closeModal);
        document.getElementById('submitOperationalReset').addEventListener('click', submitReset);
        document.getElementById('operationalResetConfirmation').addEventListener('input', (event) => {
            document.getElementById('submitOperationalReset').disabled = event.target.value !== CONFIRMATION_PHRASE;
        });
    });
})();
