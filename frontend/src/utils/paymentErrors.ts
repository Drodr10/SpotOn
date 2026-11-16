/**
 * User-facing copy for Stripe PaymentSheet errors.
 *
 * Stripe's card errors (declines, insufficient funds, expired card, wrong CVC)
 * already carry a human-readable, localized message written for the payer, so
 * those are shown as-is. Everything else (SDK/network/config failures) gets
 * friendly copy instead of the raw code ("Error: Failed") or a developer
 * message. The raw error is still logged by the caller.
 */

export interface PaymentSheetErrorLike {
  code?: string;
  message?: string;
  localizedMessage?: string;
  declineCode?: string;
  stripeErrorCode?: string;
  type?: string;
}

export interface PaymentErrorCopy {
  title: string;
  message: string;
}

const GENERIC: PaymentErrorCopy = {
  title: 'Payment not completed',
  message: "Something went wrong and you weren't charged. Please try again.",
};

/** Error from initPaymentSheet: the form never opened, nothing was charged. */
export function paymentSheetInitErrorCopy(): PaymentErrorCopy {
  return {
    title: 'Payment unavailable',
    message: "We couldn't open the payment form. Check your connection and try again. You weren't charged.",
  };
}

/** Error from presentPaymentSheet (callers skip code === 'Canceled'). */
export function paymentSheetErrorCopy(err: PaymentSheetErrorLike | null | undefined): PaymentErrorCopy {
  if (!err) return GENERIC;

  const isCardError =
    err.type === 'card_error' ||
    !!err.declineCode ||
    err.stripeErrorCode === 'card_declined' ||
    err.stripeErrorCode === 'expired_card' ||
    err.stripeErrorCode === 'incorrect_cvc' ||
    err.stripeErrorCode === 'incorrect_number' ||
    err.stripeErrorCode === 'insufficient_funds' ||
    err.stripeErrorCode === 'processing_error';
  const human = (err.localizedMessage ?? err.message ?? '').trim();
  if (isCardError && human) {
    return { title: 'Payment declined', message: human };
  }

  if (err.code === 'Timeout' || err.type === 'api_connection_error') {
    return {
      title: 'Payment timed out',
      message: "We couldn't reach the payment service. Check your connection and try again. You weren't charged.",
    };
  }

  return GENERIC;
}
