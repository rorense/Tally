import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cashbackClaims,
  cashbackSourceLabel,
  cashbackValueLabel,
  computeCashbackAmount,
  confirmedCashbackNzd,
  initialCashbackStatus,
  netExpenseNzd,
  type CashbackRow,
} from './cashback.ts';

/** An expense claiming nothing, to be overridden one scheme at a time. */
function row(over: Partial<CashbackRow> = {}): CashbackRow {
  return {
    shopback_type: null,
    shopback_value: null,
    shopback_amount: null,
    shopback_amount_nzd: null,
    shopback_status: null,
    shopback_confirmed_at: null,
    card_value: null,
    card_amount: null,
    card_amount_nzd: null,
    card_status: null,
    card_confirmed_at: null,
    ...over,
  };
}

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
  assert.equal(initialCashbackStatus('shopback'), 'pending');
});

test('one purchase can claim from the card and from ShopBack at once', () => {
  const claims = cashbackClaims(
    row({
      shopback_type: 'percent',
      shopback_value: 5,
      shopback_amount_nzd: 6,
      shopback_status: 'pending',
      card_value: 0.8,
      card_amount_nzd: 0.96,
      card_status: 'confirmed',
    })
  );
  assert.deepEqual(
    claims.map((c) => c.source),
    ['shopback', 'card']
  );
  assert.equal(claims[0].amount_nzd, 6);
  assert.equal(claims[1].amount_nzd, 0.96);
});

test('a card claim written by an older build still reads as a card claim', () => {
  const claims = cashbackClaims(
    row({
      shopback_type: 'card',
      shopback_value: 0.8,
      shopback_amount_nzd: 0.96,
      shopback_status: 'confirmed',
    })
  );
  assert.equal(claims.length, 1);
  assert.equal(claims[0].source, 'card');
  assert.equal(claims[0].amount_nzd, 0.96);
});

test('a claim moved into the card columns is not also counted where it used to be', () => {
  const moved = row({
    shopback_type: 'card',
    shopback_value: 0.8,
    shopback_amount_nzd: 0.96,
    shopback_status: 'confirmed',
    card_value: 0.8,
    card_amount_nzd: 0.96,
    card_status: 'confirmed',
  });
  assert.equal(cashbackClaims(moved).length, 1);
  assert.equal(confirmedCashbackNzd(moved), 0.96);
});

test('only confirmed cashback reduces what a trip cost', () => {
  const base = { amount_nzd: 100 };
  assert.equal(
    netExpenseNzd({
      ...base,
      ...row({ shopback_type: 'percent', shopback_status: 'confirmed', shopback_amount_nzd: 0.8 }),
    }),
    99.2
  );
  assert.equal(
    netExpenseNzd({
      ...base,
      ...row({ shopback_type: 'percent', shopback_status: 'pending', shopback_amount_nzd: 0.8 }),
    }),
    100
  );
  assert.equal(
    netExpenseNzd({
      ...base,
      ...row({ shopback_type: 'percent', shopback_status: 'cancelled', shopback_amount_nzd: 0.8 }),
    }),
    100
  );
  assert.equal(netExpenseNzd({ ...base, ...row() }), 100);
});

test('both schemes come off a purchase that claimed from each', () => {
  const both = {
    amount_nzd: 100,
    ...row({
      shopback_type: 'percent',
      shopback_status: 'confirmed',
      shopback_amount_nzd: 5,
      card_amount_nzd: 0.8,
      card_status: 'confirmed',
    }),
  };
  assert.equal(netExpenseNzd(both), 94.2);

  // The card posts on its own; a ShopBack offer still waiting does not count.
  const cardOnly = { ...both, shopback_status: 'pending' as const };
  assert.equal(netExpenseNzd(cardOnly), 99.2);
});

test('a claim with no recorded amount is worth nothing, not NaN', () => {
  assert.equal(
    confirmedCashbackNzd(
      row({ shopback_type: 'percent', shopback_status: 'confirmed', shopback_amount_nzd: null })
    ),
    0
  );
});

test('rows say which scheme pays, now that both can pay at once', () => {
  assert.equal(cashbackSourceLabel('card'), 'Card');
  assert.equal(cashbackSourceLabel('shopback'), 'ShopBack');
});

test('the value label shows a rate for percentages and money for flat offers', () => {
  assert.equal(cashbackValueLabel('card', 0.8, 'EUR'), '0.8%');
  assert.equal(cashbackValueLabel('percent', 5, 'EUR'), '5%');
  assert.match(cashbackValueLabel('flat', 4.5, 'EUR'), /4\.50/);
});
