import { AccessStatusGuard } from '@/components/access-status';
import { FulfillmentScreen } from '@/screens/FulfillmentScreen';

export default function FulfillmentRoute() {
  return (
    <AccessStatusGuard allowed={['APPROVED', 'ACTIVE']}>
      <FulfillmentScreen />
    </AccessStatusGuard>
  );
}
