import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { api } from '@/src/utils/api';
import { type Booking } from '@/src/utils/activity';
import { hapticSuccess, hapticWarning } from './motion';

/**
 * Renter cancellation — same confirm copy and the same backend call
 * (`api.cancelReservation` -> POST /api/stripe/cancel-reservation) the old
 * reservations page used. The server enforces the 24h window and refunds in full.
 */
export function useCancelBooking(onCancelled: (bookingId: string) => void) {
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const requestCancel = useCallback(
    (b: Booking) => {
      hapticWarning();
      Alert.alert(
        'Cancel this reservation?',
        'You’ll be refunded in full, including the service fee.',
        [
          { text: 'Keep it', style: 'cancel' },
          {
            text: 'Cancel reservation',
            style: 'destructive',
            onPress: async () => {
              setCancellingId(b.id);
              const result = await api.cancelReservation(b.id);
              setCancellingId(null);
              if (result.status === 'cancelled') {
                hapticSuccess();
                onCancelled(b.id);
              } else {
                Alert.alert('Could not cancel', result.message);
              }
            },
          },
        ],
      );
    },
    [onCancelled],
  );

  return { cancellingId, requestCancel };
}
