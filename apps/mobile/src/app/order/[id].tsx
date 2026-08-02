import { AccessStatusGuard } from '@/components/access-status';
import { OrderDetailScreen } from '@/screens/OrderDetailScreen';

export default function OrderDetailRoute() {
  return (
    <AccessStatusGuard allowed={['APPROVED', 'ACTIVE']}>
      <OrderDetailScreen />
    </AccessStatusGuard>
  );
}
