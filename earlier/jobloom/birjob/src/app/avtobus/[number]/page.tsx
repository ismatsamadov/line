import { Metadata } from 'next';
import { ldJson } from '@/lib/ld/serialize';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Bus, ArrowLeft, MapPin, Clock, Route, Wallet, ExternalLink } from 'lucide-react';
import { getBusByNumber, getBusStops, getAllBusNumbers } from '@/lib/bus';
import { getNonce } from '@/lib/csp';

interface Props {
  params: Promise<{ number: string }>;
}

const SITE = 'https://www.birjob.com';

export const revalidate = 86400;

// Pre-render every route at build for instant, indexable pages.
export async function generateStaticParams() {
  const numbers = await getAllBusNumbers();
  return numbers.map(number => ({ number }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { number } = await params;
  const bus = await getBusByNumber(number);
  if (!bus) return {};
  const url = `${SITE}/avtobus/${bus.number}`;
  const title = `${bus.number} nömrəli avtobus — marşrut, dayanacaqlar (Bakı)`;
  const description = `Bakı ${bus.number} nömrəli avtobusun marşrutu: ${bus.first_point} ↔ ${bus.last_point}. Dayanacaqlar, gediş haqqı (${bus.tariff_str}), məsafə və təxmini vaxt. Daşıyıcı: ${bus.carrier}.`;
  return {
    title: { absolute: `${title} | BirJob` },
    description: description.slice(0, 200),
    keywords: [`${bus.number} nömrəli avtobus`, `${bus.number} nomreli avtobus`, `${bus.number} avtobus`, 'bakı avtobus marşrutu', 'avtobus dayanacaqları'],
    alternates: { canonical: url },
    openGraph: { title, description: description.slice(0, 200), url, type: 'website' },
  };
}

export default async function BusRoutePage({ params }: Props) {
  const { number } = await params;
  const bus = await getBusByNumber(number);
  if (!bus) notFound();

  const [stops, nonce] = await Promise.all([getBusStops(bus.id), getNonce()]);
  const url = `${SITE}/avtobus/${bus.number}`;

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BusTrip',
    '@id': url,
    name: `${bus.number} nömrəli avtobus`,
    provider: { '@type': 'Organization', name: bus.carrier },
    departureBusStop: { '@type': 'BusStop', name: bus.first_point },
    arrivalBusStop: { '@type': 'BusStop', name: bus.last_point },
  };

  const stat = (icon: React.ReactNode, label: string, value: string) => (
    <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white px-3 py-2.5">
      <span className="text-gray-400">{icon}</span>
      <div>
        <div className="text-[11px] uppercase tracking-wide text-gray-400">{label}</div>
        <div className="text-sm font-semibold text-gray-900">{value}</div>
      </div>
    </div>
  );

  return (
    <>
      <script nonce={nonce} type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(schema) }} />
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-2xl mx-auto px-4 py-8 sm:py-10">
          <Link href="/avtobus" className="inline-flex items-center text-sm text-gray-600 hover:text-orange-600 transition-colors mb-4">
            <ArrowLeft className="h-4 w-4 mr-1" /> Bütün avtobuslar
          </Link>

          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
              <Bus className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-gray-900 sm:text-3xl">{bus.number} nömrəli avtobus</h1>
              <p className="text-sm text-gray-600">{bus.first_point} ↔ {bus.last_point}</p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stat(<Wallet className="h-4 w-4" />, 'Gediş haqqı', bus.tariff_str || '—')}
            {stat(<Route className="h-4 w-4" />, 'Məsafə', bus.route_length ? `${bus.route_length} km` : '—')}
            {stat(<Clock className="h-4 w-4" />, 'Təxmini vaxt', bus.duration_minuts ? `${bus.duration_minuts} dəq` : '—')}
            {stat(<Bus className="h-4 w-4" />, 'Daşıyıcı', bus.carrier || '—')}
          </div>

          {/* Stops */}
          <div className="mt-6 rounded-2xl border border-gray-100 bg-white p-5 sm:p-6 shadow-sm">
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-gray-900">
              <MapPin className="h-4 w-4 text-orange-500" /> Dayanacaqlar ({stops.length})
            </h2>
            {stops.length === 0 ? (
              <p className="text-sm text-gray-500">Bu marşrut üçün dayanacaq məlumatı tapılmadı.</p>
            ) : (
              <ol className="relative border-l border-gray-200 pl-5">
                {stops.map((s, i) => (
                  <li key={`${s}-${i}`} className="relative mb-3 last:mb-0">
                    <span className="absolute -left-[23px] top-1 h-2.5 w-2.5 rounded-full border-2 border-orange-400 bg-white" />
                    <span className="text-sm text-gray-800">{s}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* Planner CTA */}
          <div className="mt-6 rounded-2xl border border-gray-100 bg-white p-5 text-center shadow-sm">
            <p className="text-sm text-gray-700">İki dayanaca arasında ən yaxşı marşrutu (dəyişmələrlə) tapmaq üçün:</p>
            <Link href="/aletler/avtobus-marsrutu" className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-xl bg-orange-600 px-5 py-3 text-sm font-semibold text-white hover:bg-orange-700 transition-colors">
              Avtobus marşrut planlayıcısı <ExternalLink className="h-4 w-4" />
            </Link>
          </div>

          <p className="mt-6 text-xs text-gray-400">
            Məlumat Ayna açıq nəqliyyat məlumatlarına əsaslanır — marşrut topologiyasıdır, real-vaxt cədvəl deyil.
          </p>
        </div>
      </div>
    </>
  );
}
