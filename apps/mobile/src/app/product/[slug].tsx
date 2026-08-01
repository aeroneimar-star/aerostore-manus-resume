import { type Href, Redirect } from 'expo-router';

export default function ProductRoute() {
  return <Redirect href={'/access-status' as Href} />;
}
