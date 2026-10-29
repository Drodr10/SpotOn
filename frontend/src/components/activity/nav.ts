import { router } from 'expo-router';

export function openBookingDetails(id: string) {
  router.push({ pathname: '/ActivityDetails', params: { id } } as any);
}
