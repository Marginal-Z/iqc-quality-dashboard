import { addTranslations, translate, text } from './client.js';
import translations from './settings-i18n.js';
import employeeTranslations from './employee-i18n.js';
addTranslations(translations); addTranslations(employeeTranslations);
const links = [
  ['/settings', 'generalSettings', false], ['/settings/qc', 'qcEmployees', true], ['/settings/warehouse', 'warehouseEmployees', true],
  ['/settings/notifications', 'notificationSettings', true], ['/settings/history', 'historySettings', true],
  ['/settings/connection', 'connectionSettings', true], ['/accounts', 'accounts', true]
];
export function initSettingsNavigation(role) {
  const root = document.getElementById('settingsNavigation'); if (!root) return;
  root.replaceChildren();
  const title = document.createElement('h2'); title.dataset.authText = 'settingsTitle'; root.append(title);
  for (const [href, label, admin] of links) {
    if (admin && role !== 'admin') continue;
    const link = document.createElement('a'); link.href = href; link.dataset.authText = label;
    if (location.pathname === href || ['/reminders', '/settings/employees'].includes(location.pathname) && href === '/settings/qc') link.setAttribute('aria-current', 'page');
    root.append(link);
  }
  root.setAttribute('aria-label', text('settingsTitle')); translate();
}
