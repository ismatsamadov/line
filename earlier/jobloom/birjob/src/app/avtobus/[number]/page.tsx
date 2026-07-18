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

  const [stops, allNumbers, nonce] = await Promise.all([
    getBusStops(bus.id), getAllBusNumbers(), getNonce(),
  ]);
  const url = `${SITE}/avtobus/${bus.number}`;

  // Unique, indexable intro copy (thin "stats + list" pages don't rank — this
  // gives each route real, distinct prose built from its own data).
  const intro = [
    `Bakıda ${bus.number} nömrəli avtobus ${bus.first_point} ilə ${bus.last_point} arasında hərəkət edir.`,
    stops.length ? `Marşrut boyunca ${stops.length} dayanacaq var.` : '',
    bus.route_length ? `Ümumi uzunluğu təxminən ${bus.route_length} km-dir.` : '',
    bus.duration_minuts ? `Bütün marşrutu getmək təxminən ${bus.duration_minuts} dəqiqə çəkir.` : '',
    `Daşıyıcı: ${bus.carrier}${bus.tariff_str ? `, gediş haqqı ${bus.tariff_str}` : ''}.`,
  ].filter(Boolean).join(' ');

  // FAQ — targets the exact question queries ("<N> avtobusu neçə dayanacaq",
  // "gediş haqqı neçədir") and drives an FAQ rich result. Only real data.
  const faqs: { q: string; a: string }[] = [];
  if (bus.tariff_str) faqs.push({
    q: `${bus.number} nömrəli avtobusun gediş haqqı neçədir?`,
    a: `${bus.number} nömrəli avtobusda gediş haqqı ${bus.tariff_str}-dir.`,
  });
  if (stops.length) faqs.push({
    q: `${bus.number} avtobusu neçə dayanacaqdan keçir?`,
    a: `${bus.number} nömrəli avtobus ${bus.first_point} ilə ${bus.last_point} arasında ${stops.length} dayanacaqdan keçir.`,
  });
  if (bus.duration_minuts) faqs.push({
    q: `${bus.number} avtobusu ilə yol təxminən nə qədər çəkir?`,
    a: `Bütün marşrut${bus.route_length ? ` (${bus.route_length} km)` : ''} təxminən ${bus.duration_minuts} dəqiqə çəkir. Bu, real-vaxt cədvəl deyil — marşrut məsafəsinə əsaslanan təxmindir.`,
  });
  faqs.push({
    q: `${bus.number} avtobusu haradan haraya gedir?`,
    a: `${bus.number} nömrəli avtobus ${bus.first_point} ilə ${bus.last_point} arasında işləyir. Daşıyıcı: ${bus.carrier}.`,
  });

  // Related routes: nearby numbers for internal linking (helps crawl + spreads
  // link equity across the ~200 route pages instead of leaving them orphaned).
  const idx = allNumbers.indexOf(bus.number);
  const related = (idx >= 0
    ? [...allNumbers.slice(Math.max(0, idx - 4), idx), ...allNumbers.slice(idx + 1, idx + 5)]
    : allNumbers.slice(0, 8)
  ).slice(0, 8);

  const busTrip = {
    '@context': 'https://schema.org',
    '@type': 'BusTrip',
    '@id': url,
    name: `${bus.number} nömrəli avtobus`,
    provider: { '@type': 'Organization', name: bus.carrier },
    departureBusStop: { '@type': 'BusStop', name: bus.first_point },
    arrivalBusStop: { '@type': 'BusStop', name: bus.last_point },
    ...(stops.length ? { itinerary: stops.map(name => ({ '@type': 'BusStop', name })) } : {}),
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Ana səhifə', item: SITE },
      { '@type': 'ListItem', position: 2, name: 'Avtobuslar', item: `${SITE}/avtobus` },
      { '@type': 'ListItem', position: 3, name: `${bus.number} nömrəli avtobus`, item: url },
    ],
  };
  const faqSchema = faqs.length ? {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({
      '@type': 'Question', name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  } : null;

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
      <script nonce={nonce} type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(busTrip) }} />
      <script nonce={nonce} type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(breadcrumb) }} />
      {faqSchema && <script nonce={nonce} type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(faqSchema) }} />}
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

          <p className="mt-4 text-[15px] leading-relaxed text-gray-700">{intro}</p>

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

          {/* FAQ — visible + drives the FAQPage rich result */}
          {faqs.length > 0 && (
            <div className="mt-6 rounded-2xl border border-gray-100 bg-white p-5 sm:p-6 shadow-sm">
              <h2 className="mb-3 text-base font-bold text-gray-900">Tez-tez verilən suallar</h2>
              <div className="space-y-4">
                {faqs.map(f => (
                  <div key={f.q}>
                    <p className="text-sm font-semibold text-gray-900">{f.q}</p>
                    <p className="mt-1 text-sm text-gray-600">{f.a}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Related routes — internal linking across the ~200 route pages */}
          {related.length > 0 && (
            <div className="mt-6">
              <h2 className="mb-2 text-sm font-bold text-gray-900">Digər avtobus marşrutları</h2>
              <div className="flex flex-wrap gap-2">
                {related.map(n => (
                  <Link key={n} href={`/avtobus/${n}`} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 transition hover:border-orange-400 hover:text-orange-600">
                    {n}
                  </Link>
                ))}
                <Link href="/avtobus" className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-orange-600 transition hover:border-orange-400">
                  Hamısı →
                </Link>
              </div>
            </div>
          )}

          <p className="mt-6 text-xs text-gray-400">
            Məlumat Ayna açıq nəqliyyat məlumatlarına əsaslanır — marşrut topologiyasıdır, real-vaxt cədvəl deyil.
          </p>
        </div>
      </div>
    </>
  );
}
