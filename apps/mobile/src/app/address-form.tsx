import { AccessStatusGuard } from '@/components/access-status';
import { AddressFormScreen } from '@/screens/AddressFormScreen';

export default function AddressFormRoute() {
  return (
    <AccessStatusGuard allowed={['APPROVED', 'ACTIVE']}>
      <AddressFormScreen />
    </AccessStatusGuard>
  );
}
