import { AccessStatusGuard } from '@/components/access-status';
import { AddressListScreen } from '@/screens/AddressListScreen';

export default function AddressListRoute() {
  return (
    <AccessStatusGuard allowed={['APPROVED', 'ACTIVE']}>
      <AddressListScreen />
    </AccessStatusGuard>
  );
}
