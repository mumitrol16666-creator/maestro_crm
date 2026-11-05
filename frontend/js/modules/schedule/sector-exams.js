// Exams have one entry point. CRM only displays their booked lessons and attendance.
function renderSectorExamBanner() {
    const root=document.getElementById('sectorExamBanner');
    if (!root) return;
    root.hidden=typeof isAdmin==='function'&&!isAdmin();
    root.className='sector-exam-banner';
    root.innerHTML='<strong>Экзамены</strong><p>Задания, участники, назначение и результаты — в приложении Maestro.</p><a class="btn-primary" href="https://app.maestro.com.kz/admin/sector-exams" target="_blank" rel="noopener">Открыть экзамены в приложении</a>';
}
function updateClassModalSectorExamOffer() {
    const offer=document.getElementById('classSectorExamOffer');
    if (offer) offer.hidden=Boolean(document.getElementById('classId')?.value)||(typeof isAdmin==='function'&&!isAdmin());
}
window.renderSectorExamBanner=renderSectorExamBanner;
window.updateClassModalSectorExamOffer=updateClassModalSectorExamOffer;
