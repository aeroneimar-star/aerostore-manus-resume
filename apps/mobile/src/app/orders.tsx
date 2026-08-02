import { AccessStatusGuard } from '@/components/access-status';
import { OrderHistoryScreen } from '@/screens/OrderHistoryScreen';

export default function OrdersRoute() {
  return (
    <AccessStatusGuard allowed={['APPROVED', 'ACTIVE']}>
      <OrderHistoryScreen />
    </AccessStatusGuard>
  );
}
