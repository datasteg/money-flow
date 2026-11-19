// The old Economies list: the economy filter on the Economy tab replaced it.
import { redirect } from 'next/navigation';

export default async function Economies({ params }: { params: Promise<{ lang: string }> }) {
  redirect(`/${(await params).lang}`);
}
