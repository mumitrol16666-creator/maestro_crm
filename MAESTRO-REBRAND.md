# Maestro CRM Rebrand

Sense of Dance CRM rebranded for **Музыкальная школа Maestro**.

## Done in this pass

- Gold/cream/ink palette instead of pink/black dance theme
- Maestro text logo on login and admin sidebar
- Titles: `Maestro CRM`, `CRM школы`
- Favicon: `frontend/assets/images/maestro-icon.svg`
- API branding in `backend/src/server.js`
- CORS: `maestro-school.duckdns.org` allowed
- Brand config: `frontend/js/brand.js`

## Still manual (when ready)

1. Replace dance **directions** in DB with music (Гитара, Вокал, …) via admin → Направления
2. Update **Telegram bot** texts (`backend/update-bot-prompt.js`)
3. Point **domain** / nginx to this CRM if moving off senseofdance.kz
4. Replace old `logo-splash.PNG` everywhere if any cached pages remain
5. Rebuild minified CSS/JS if production serves `.min` files

## Local run

```bash
cd backend && npm run dev
cd frontend && python3 -m http.server 8000
```

Open: `http://localhost:8000/public/login.html`
