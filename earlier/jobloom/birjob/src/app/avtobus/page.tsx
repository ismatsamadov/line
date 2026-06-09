import { Metadata } from 'next';
import Link from 'next/link';
import { Bus, ArrowLeft, ExternalLink } from 'lucide-react';
import { getAllBusNumbers } from '@/lib/bus';

const SITE = 'https://www.birjob.com';
const PAGE_URL = `${SITE}/avtobus`;

export const revalidate = 86400;

export const metadata: Metadata = {
  title: { absolute: 'Bakı avtobus xətləri — bütün marşrutlar və dayanacaqlar | BirJob' },
  description:
    'Bakının bütün avtobus xətləri bir yerdə. Avtobus nömrəsini seçin — marşrutu, dayanacaqları, gediş haqqını və təxmini vaxtı görün. İki dayanaca arasında marşrut planlamaq üçün marşrut planlayıcısı da var.',
  keywords: ['bakı avtobus xətləri', 'avtobus marşrutları', 'bakı avtobuslar', 'avtobus dayanacaqları', 'nömrəli avtobus', 'baku bus routes'],
  alternates: { canonical: PAGE_URL },
  openGraph: { title: 'Bakı avtobus xətləri — bütün marşrutlar', description: 'Bakının bütün avtobus marşrutları, dayanacaqları və gediş haqqı.', url: PAGE_URL, type: 'website' },
};

export default async function AvtobusIndexPage() {
  const numbers = await getAllBusNumbers();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8 sm:py-10">
        <Link href="/" className="inline-flex items-center text-sm text-gray-600 hover:text-orange-600 transition-colors mb-4">
          <ArrowLeft className="h-4 w-4 mr-1" /> Ana səhifə
        </Link>

        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
            <Bus className="h-5 w-5" />
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900 sm:text-3xl">Bakı avtobus xətləri</h1>
        </div>
        <p className="mt-3 text-[15px] leading-relaxed text-gray-700">
          Bakının <strong>{numbers.length}</strong> avtobus marşrutu. Nömrəni seçin — marşrutu, dayanacaqları,
          gediş haqqını və təxmini vaxtı görün.
        </p>

        <div className="mt-5 mb-6 rounded-2xl border border-gray-100 bg-white p-4 text-sm text-gray-700 shadow-sm">
          İki dayanaca arasında ən yaxşı marşrutu (dəyişmələrlə, xəritədə) tapmaq üçün{' '}
          <Link href="/aletler/avtobus-marsrutu" className="inline-flex items-center font-semibold text-orange-600 hover:underline">
            marşrut planlayıcısı <ExternalLink className="h-3.5 w-3.5 ml-0.5" />
          </Link>.
        </div>

        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
          {numbers.map(n => (
            <Link
              key={n}
              href={`/avtobus/${n}`}
              className="flex items-center justify-center rounded-xl border border-gray-200 bg-white py-3 text-sm font-bold text-gray-800 transition hover:border-orange-400 hover:text-orange-600 hover:shadow-sm"
            >
              {n}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
