import { AccessStatusGuard } from '@/components/access-status';
import { CartScreen } from '@/screens/CartScreen';

export default function CartRoute() {
  return (
    <AccessStatusGuard allowed={['APPROVED', 'ACTIVE']}>
      <CartScreen />
    </AccessStatusGuard>
  );
}
