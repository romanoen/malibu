const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const { normalizePublicBaseUrl, parseStripePaymentMethodTypes } = require('../server');

test('normalizes public base urls for Stripe redirects', () => {
  assert.equal(
    normalizePublicBaseUrl('malibu-staging.up.railway.app/'),
    'https://malibu-staging.up.railway.app'
  );
  assert.equal(
    normalizePublicBaseUrl('https://malibu-staging.up.railway.app/'),
    'https://malibu-staging.up.railway.app'
  );
  assert.equal(
    normalizePublicBaseUrl('localhost:3000'),
    'http://localhost:3000'
  );
});

test('defaults Stripe Checkout methods to card and PayPal', () => {
  assert.deepEqual(parseStripePaymentMethodTypes(''), ['card', 'paypal']);
  assert.deepEqual(parseStripePaymentMethodTypes('card, paypal, sepa_debit'), ['card', 'paypal', 'sepa_debit']);
});
