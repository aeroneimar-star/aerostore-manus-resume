import { type Href, Redirect } from 'expo-router';

export default function CatalogRoute() {
  return <Redirect href={'/access-status' as Href} />;
}
