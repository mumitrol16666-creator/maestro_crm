window.MAESTRO_BRAND = {
  name: 'Maestro',
  fullName: 'Музыкальная школа Maestro',
  crmTitle: 'Maestro CRM',
  tagline: 'CRM музыкальной школы',
  schoolType: 'музыкальная школа',
  website: 'https://maestro-school.duckdns.org',
  logoUrl: '/assets/images/maestro-icon.svg',
  logoMaskableUrl: '/assets/images/maestro-icon-maskable.svg',
  // Укажите номер школы, когда будет известен:
  supportPhone: '',
};

window.getMaestroSupportText = function () {
  const brand = window.MAESTRO_BRAND || {};
  if (brand.supportPhone) {
    return brand.supportPhone;
  }
  return brand.website || 'maestro-school.duckdns.org';
};

window.getMaestroSupportMessage = function () {
  const brand = window.MAESTRO_BRAND || {};
  if (brand.supportPhone) {
    return `Свяжитесь с администратором: ${brand.supportPhone}`;
  }
  return `Свяжитесь с администратором: ${brand.website || 'сайт школы'}`;
};
