import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import { promoUi } from '../src/browser.js';
import { applyPlan, makePlan } from '../src/plan.js';

const endpoint = process.env.RC_TEST_CDP_URL;
const windowFields = name => `
  <p>${name}</p>
  <label><input type="radio" name="${name}" checked>Не ограничено</label>
  <label><input type="radio" name="${name}" data-enables="period">Действует в период с</label>
  <input disabled><input disabled>`;

const fixture = `
  <a href="#" id="promos">Промокоды</a>
  <section hidden>
    <button id="add">Добавить новый</button>
    <button id="filter">Этот месяц</button>
    <a href="#" id="all" hidden>За все время</a>
    <table>
      <thead><tr><th>Промокоды</th><th>Номинал</th></tr></thead>
      <tbody><tr><td>Итого</td><td>-</td></tr></tbody>
    </table>
  </section>
  <dialog>
    <h2>Создание промокода</h2>
    <label>Название *<input id="code"></label>
    <label>Скидка *<input id="discount"></label>
    <select id="unit"><option>%</option><option>₽</option></select>
    <label>Мин. сумма брони для применения промокода<input id="minimum"></label>
    <label>Мин. длительность проживания<input id="nights"></label>
    <label><input type="radio" name="uses" checked>Не ограничено</label>
    <label><input type="radio" name="uses" data-enables="uses">Ограничено</label><input disabled id="uses">
    <label><input type="radio" name="expiry" checked>Не ограничено</label>
    <label><input type="radio" name="expiry" data-enables="expiry">Действует до</label><input disabled placeholder="Не задано" id="expiry">
    ${windowFields('Когда можно бронировать')}
    ${windowFields('В какой период можно применить')}
    <button id="submit">Добавить промокод</button>
  </dialog>
  <script>
    const $ = id => document.getElementById(id);
    const dialog = document.querySelector('dialog');
    $('promos').onclick = e => { e.preventDefault(); document.querySelector('section').hidden = false; };
    $('filter').onclick = () => $('all').hidden = false;
    $('all').onclick = e => { e.preventDefault(); $('filter').textContent = 'За все время'; $('all').hidden = true; };
    $('add').onclick = () => dialog.showModal();
    for (const radio of document.querySelectorAll('[data-enables]')) {
      radio.onchange = () => {
        const field = radio.parentElement.nextElementSibling;
        field.disabled = false;
        if (radio.dataset.enables === 'period') field.nextElementSibling.disabled = false;
      };
    }
    $('submit').onclick = () => {
      const row = document.querySelector('tbody').insertRow(0);
      row.insertCell().textContent = $('code').value;
      row.insertCell().textContent = $('discount').value + ' ' + $('unit').value;
      row.dataset.fields = JSON.stringify([...dialog.querySelectorAll('input:not([type=radio])')].map(input => input.value));
      dialog.close();
    };
  </script>`;

test('Chrome CDP submits the booking and stay windows and reconciles the exact names', { skip: !endpoint, timeout: 150000 }, async () => {
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 15000 });
  const page = await browser.contexts()[0].newPage();
  try {
    page.setDefaultTimeout(18000);
    await page.setContent(fixture);
    const ui = promoUi(page);
    await ui.open();
    const plan = makePlan({
      count: 2, discount: { unit: 'RUB', value: 100 }, min_total_rub: 2000,
      expires_on: '2030-07-31', booking_from: '2030-07-01', booking_until: '2030-07-31',
      stay_from: '2030-08-01', stay_until: '2030-08-31',
    });
    const result = await applyPlan(plan, ui);
    assert.deepEqual(result.pending, [], JSON.stringify(result));
    const fields = await page.locator('tr[data-fields]').evaluateAll(rows => rows.map(row => JSON.parse(row.dataset.fields)));
    assert.equal(fields.length, 2);
    for (const values of fields) {
      assert.deepEqual(values.slice(1), ['100', '2000', '1', '1', '31.07.2030', '01.07.2030', '31.07.2030', '01.08.2030', '31.08.2030']);
    }
    const retry = await applyPlan(plan, ui);
    assert.equal(retry.verified.length, 2);
    assert.ok(retry.verified.every(item => item.status === 'already_listed'));
  } finally {
    await page.close();
    await browser.close();
  }
});
