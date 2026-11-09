import { chromium } from 'playwright-core';

const settings = 'https://realtycalendar.ru/settings/#/bookings_module';
const quote = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const radio = (scope, name) => scope.getByRole('radio', { name, exact: true });

function endpoint() {
  const url = new URL(process.env.RC_CDP_URL || 'http://127.0.0.1:9222');
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
      !url.port || url.pathname !== '/' || url.username || url.password || url.search || url.hash) {
    throw new Error('RC_CDP_URL must be a loopback HTTP URL, e.g. http://127.0.0.1:9222.');
  }
  return url.href;
}

async function activate(control) {
  await control.press('Enter');
}

async function setDate(control, date) {
  const info = await control.evaluate(input => ({ type: input.type, readOnly: input.readOnly, placeholder: input.placeholder }));
  if (info.readOnly) throw new Error('The date control is read-only. This RC form version needs a compatible adapter.');
  const [year, month, day] = date.split('-');
  const value = info.type === 'date' ? date : `${day}.${month}.${year}`;
  await control.fill(value);
  await control.press('Tab');
  if (await control.inputValue() !== value) throw new Error('RealtyCalendar did not retain a requested date.');
}

export function promoUi(page) {
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Создание промокода', exact: true }) });
  const table = page.getByRole('table').filter({ hasText: 'Промокоды' });
  const cell = code => page.getByText(code, { exact: true });
  const row = code => table.getByRole('row').filter({ has: cell(code) });
  const title = name => dialog.getByRole('textbox', { name: new RegExp('^' + quote(name)) });

  return {
    async open() {
      await activate(page.getByRole('link', { name: 'Промокоды', exact: true }));
      const month = page.getByRole('button', { name: /Этот месяц/ });
      const allTime = page.getByRole('button', { name: /За все время/ });
      await month.or(allTime).waitFor();
      if (await month.isVisible()) {
        await activate(month);
        await activate(page.getByRole('link', { name: 'За все время', exact: true }));
      }
      await page.getByRole('button', { name: /За все время/ }).waitFor();
      await table.waitFor();
    },
    async hasCode(code) {
      return (await row(code).count()) > 0;
    },
    async verifyCode(code) {
      await row(code).waitFor({ state: 'visible' });
    },
    async createCode(code, terms, signal) {
      await activate(page.getByRole('button', { name: 'Добавить новый', exact: true }));
      await dialog.waitFor();
      await title('Название').fill(code);
      await title('Скидка').fill(String(terms.discount.value));
      await dialog.getByRole('combobox').selectOption({ label: terms.discount.unit === 'RUB' ? '₽' : '%' });
      if (terms.min_total_rub !== undefined) {
        await title('Мин. сумма брони для применения промокода').fill(String(terms.min_total_rub));
      }
      await title('Мин. длительность проживания').fill(String(terms.min_nights));
      await radio(dialog, 'Ограничено').check();
      const unlabeled = dialog.getByRole('textbox', { name: '', exact: true });
      const expiry = dialog.getByPlaceholder('Не задано', { exact: true });
      if (await unlabeled.count() !== 5 || await expiry.count() !== 1) {
        throw new Error('Unexpected promo form layout. No code was submitted.');
      }
      await unlabeled.nth(0).fill(String(terms.max_uses));
      await radio(dialog, 'Действует до').check();
      await setDate(expiry, terms.expires_on);
      const periods = dialog.getByRole('radio', { name: 'Действует в период с', exact: true });
      if (await periods.count() !== 2) throw new Error('Unexpected booking date controls.');
      await periods.nth(0).check();
      await setDate(unlabeled.nth(1), terms.booking_from);
      await setDate(unlabeled.nth(2), terms.booking_until);
      if (terms.stay_from) {
        await periods.nth(1).check();
        await setDate(unlabeled.nth(3), terms.stay_from);
        await setDate(unlabeled.nth(4), terms.stay_until);
      }
      const submit = dialog.getByRole('button', { name: 'Добавить промокод', exact: true });
      signal?.throwIfAborted();
      await activate(submit);
      await dialog.waitFor({ state: 'hidden' });
    }
  };
}

export async function withPromoBrowser(operation) {
  // Playwright's HTTP discovery and WebSocket transport must stay on loopback.
  const bypass = [process.env.no_proxy, process.env.NO_PROXY, '127.0.0.1'].filter(Boolean).join(',');
  process.env.no_proxy = bypass;
  process.env.NO_PROXY = bypass;
  const expectedAccount = process.env.RC_ACCOUNT_ID;
  if (!/^\d{1,24}$/.test(expectedAccount || '')) {
    throw new Error('Set RC_ACCOUNT_ID to the number displayed in the RC account menu.');
  }
  const browser = await chromium.connectOverCDP(endpoint(), { timeout: 15000 });
  let page;
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error('Chrome did not expose a browser context.');
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(settings, { waitUntil: 'domcontentloaded', timeout: 12000 });
    if (new URL(page.url()).origin !== new URL(settings).origin) {
      throw new Error('RealtyCalendar redirected outside its expected origin.');
    }
    try {
      await page.getByRole('button', { name: new RegExp('^person_outline\\s+' + expectedAccount + '\\s+expand_more$') }).waitFor();
    } catch {
      throw new Error('Expected RealtyCalendar account not visible. Sign in to the dedicated Chrome profile and verify RC_ACCOUNT_ID.');
    }
    const ui = promoUi(page);
    await ui.open();
    return await operation(ui);
  } finally {
    if (page) await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
