import { addTranslations, translate, text } from './client.js';
import translations from './settings-i18n.js';
addTranslations(translations);
const links = [
  ['/settings', 'generalSettings', false], ['/settings/employees', 'employeeSettings', true],
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
    if (location.pathname === href || location.pathname === '/reminders' && href === '/settings/employees') link.setAttribute('aria-current', 'page');
    root.append(link);
  }
  root.setAttribute('aria-label', text('settingsTitle')); translate();
}
