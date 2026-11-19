// The Markets tab opens on portfolio equity.
import { redirect } from 'next/navigation';

export default async function Markets({ params }: { params: Promise<{ lang: string }> }) {
  redirect(`/${(await params).lang}/m/equity`);
}
