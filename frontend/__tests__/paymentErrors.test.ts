/**
 * Tests for the PaymentSheet error copy.
 *
 * WHAT THESE PIN
 *   * Stripe card errors (declines etc.) keep Stripe's own payer-facing message.
 *   * Non-card failures never surface the raw code or developer message.
 *   * Timeouts / connection errors get connection copy.
 */
import { paymentSheetErrorCopy, paymentSheetInitErrorCopy } from '../src/utils/paymentErrors';

describe('paymentSheetErrorCopy', () => {
  it('keeps Stripe decline messages', () => {
    const c = paymentSheetErrorCopy({
      code: 'Failed',
      message: 'Your card was declined.',
      stripeErrorCode: 'card_declined',
      declineCode: 'generic_decline',
      type: 'card_error',
    });
    expect(c).toEqual({ title: 'Payment declined', message: 'Your card was declined.' });
  });

  it('prefers the localized message for card errors', () => {
    const c = paymentSheetErrorCopy({
      code: 'Failed',
      message: 'Your card has insufficient funds.',
      localizedMessage: 'Tu tarjeta no tiene fondos suficientes.',
      type: 'card_error',
    });
    expect(c.message).toBe('Tu tarjeta no tiene fondos suficientes.');
  });

  it('hides raw codes and developer messages for non-card failures', () => {
    const c = paymentSheetErrorCopy({
      code: 'Failed',
      message: 'No such payment_intent: pi_123',
      type: 'invalid_request_error',
    });
    expect(c.message).not.toMatch(/pi_123|Failed/);
    expect(c.title).not.toMatch(/Error:/);
  });

  it('uses connection copy for timeouts', () => {
    expect(paymentSheetErrorCopy({ code: 'Timeout', message: 'x' }).title).toBe('Payment timed out');
    expect(paymentSheetErrorCopy({ code: 'Failed', type: 'api_connection_error' }).title).toBe(
      'Payment timed out',
    );
  });

  it('handles a missing error', () => {
    expect(paymentSheetErrorCopy(undefined).title).toBe('Payment not completed');
  });

  it('init copy has no code', () => {
    expect(paymentSheetInitErrorCopy().message).not.toMatch(/Error:/);
  });
});
