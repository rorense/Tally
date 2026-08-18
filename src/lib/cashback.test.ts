import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cashbackSourceLabel,
  cashbackValueLabel,
  computeCashbackAmount,
  confirmedCashbackNzd,
  initialCashbackStatus,
  netExpenseNzd,
} from './cashback.ts';

test('card cashback is a percentage of the spend, like a ShopBack percent offer', () => {
  assert.equal(computeCashbackAmount(120, 'card', 0.8), 0.96);
  assert.equal(computeCashbackAmount(120, 'percent', 0.8), 0.96);
});

test('a flat offer ignores the expense amount', () => {
  assert.equal(computeCashbackAmount(120, 'flat', 5), 5);
});

test('card cashback starts confirmed because it posts to the statement on its own', () => {
  assert.equal(initialCashbackStatus('card'), 'confirmed');
});

test('ShopBack offers start pending until the rebate is verified', () => {
  assert.equal(initialCashbackStatus('percent'), 'pending');
  assert.equal(initialCashbackStatus('flat'), 'pending');
});

test('only confirmed cashback reduces what a trip cost', () => {
  const base = { amount_nzd: 100 };
  assert.equal(
    netExpenseNzd({ ...base, shopback_status: 'confirmed', shopback_amount_nzd: 0.8 }),
    99.2
  );
  assert.equal(
    netExpenseNzd({ ...base, shopback_status: 'pending', shopback_amount_nzd: 0.8 }),
    100
  );
  assert.equal(
    netExpenseNzd({ ...base, shopback_status: 'cancelled', shopback_amount_nzd: 0.8 }),
    100
  );
  assert.equal(netExpenseNzd({ ...base, shopback_status: null, shopback_amount_nzd: null }), 100);
});

test('a claim with no recorded amount is worth nothing, not NaN', () => {
  assert.equal(
    confirmedCashbackNzd({ shopback_status: 'confirmed', shopback_amount_nzd: null }),
    0
  );
});

test('rows say which scheme pays, now that two of them can', () => {
  assert.equal(cashbackSourceLabel('card'), 'Card');
  assert.equal(cashbackSourceLabel('percent'), 'ShopBack');
  assert.equal(cashbackSourceLabel('flat'), 'ShopBack');
});

test('the value label shows a rate for percentages and money for flat offers', () => {
  assert.equal(cashbackValueLabel('card', 0.8, 'EUR'), '0.8%');
  assert.equal(cashbackValueLabel('percent', 5, 'EUR'), '5%');
  assert.match(cashbackValueLabel('flat', 4.5, 'EUR'), /4\.50/);
});
