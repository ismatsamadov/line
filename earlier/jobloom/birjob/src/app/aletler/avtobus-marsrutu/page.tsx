import { Metadata } from 'next';
import Link from 'next/link';
import { Bus, ChevronRight } from 'lucide-react';
import { getToolBySlug } from '@/lib/tools';
import RelatedTools from '@/components/tools/RelatedTools';
import { getNonce } from '@/lib/csp';
import JsonLd from '@/components/JsonLd';
import { buildBreadcrumb } from '@/lib/ld/breadcrumb';
import { buildWebApplication } from '@/lib/ld/webApplication';
import { buildFaqPage } from '@/lib/ld/faqPage';
import Component from './Component';

const tool = getToolBySlug('avtobus-marsrutu')!;
const PAGE_URL = `https://www.birjob.com/aletler/${tool.slug}`;

export const metadata: Metadata = {
  title: { absolute: 'Bakı Avtobus Marşrutu — Ən Yaxşı Marşrutu Tap (Pulsuz) | BirJob' },
  description: tool.description, keywords: tool.keywords,
  alternates: { canonical: PAGE_URL },
  openGraph: { images: ['/opengraph-image'], title: tool.label, description: tool.description, url: PAGE_URL, type: 'website' },
};

const FAQ = [
  { q: 'Bu alət necə işləyir?', a: 'Başlanğıc və təyinat dayanacağını seçirsiniz (adla axtarış, xəritədən toxunma və ya «yaxınımdakı dayanacaq»). Alət Bakı avtobus şəbəkəsi üzərində ən yaxşı marşrutu hesablayır: hansı avtobuslara minmək, harada dəyişmək, piyada keçidlər, ümumi məsafə və təxmini vaxt.' },
  { q: 'Vaxt dəqiqdirmi?', a: 'Xeyr — vaxt təxminidir. Bu, cədvəl və ya real-vaxt (canlı) tətbiqi deyil; marşrut topologiyası planlayıcısıdır. Hər seqmentin vaxtı marşrutun ümumi müddətinin dayanacaqlar arasında bərabər bölünməsi ilə hesablanır. Yəni «hansı avtobusa minim» sualına cavab verir, dəqiq gəliş saatına yox.' },
  { q: 'Məlumat haradandır və nə qədər təzədir?', a: 'Məlumat Ayna (Azərbaycan nəqliyyat agentliyi) açıq nəqliyyat məlumatlarına əsaslanır və dövri olaraq yenilənir. Marşrutlar şəhərdə dəyişdikcə fərqlər ola bilər; dəqiq cədvəl üçün rəsmi mənbələri yoxlayın.' },
  { q: 'Niyə bəzən piyada keçid təklif olunur?', a: 'Bəzən ən yaxşı marşrut yaxın (≤300 m) başqa bir dayanacağa qədər qısa piyada keçid + fərqli avtobusu əhatə edir. Bu, lazımsız dəyişmələri azaldır və ümumi vaxtı qısalda bilər.' },
];

export default async function Page() {
  const nonce = await getNonce();
  return (
    <>
      <JsonLd nonce={nonce} data={buildWebApplication({ name: tool.label, url: PAGE_URL, description: tool.description })} />
      <JsonLd nonce={nonce} data={buildBreadcrumb([
        { name: 'BirJob', url: '/' },
        { name: 'Alətlər', url: '/aletler' },
        { name: tool.label, url: PAGE_URL },
      ])} />
      <JsonLd nonce={nonce} data={buildFaqPage(FAQ)} />

      <main className="mx-auto max-w-6xl px-4 py-8">
        <nav className="mb-6 flex items-center gap-1 text-sm text-gray-500" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-orange-600">BirJob</Link><ChevronRight className="h-4 w-4" />
          <Link href="/aletler" className="hover:text-orange-600">Alətlər</Link><ChevronRight className="h-4 w-4" />
          <span className="text-gray-700">{tool.label}</span>
        </nav>

        <header className="mb-6">
          <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-orange-50 text-orange-600"><Bus className="h-6 w-6" /></div>
          <h1 className="text-2xl font-extrabold text-gray-900 sm:text-3xl">Bakı Avtobus Marşrutu Planlayıcısı</h1>
          <p className="mt-2 max-w-2xl text-gray-600">{tool.tagline}. İşə, müsahibəyə və ya istənilən ünvana çatmaq üçün ən yaxşı ictimai nəqliyyat marşrutunu tapın.</p>
        </header>

        <Component />

        <section className="prose prose-gray mt-10 max-w-none">
          <h2 className="text-xl font-bold text-gray-900">Necə istifadə etməli?</h2>
          <ol className="text-gray-700">
            <li><strong>Haradan:</strong> başlanğıc dayanacağını adla axtarın, xəritədən toxunun, və ya «yaxınımdakı dayanacaqdan başla» düyməsi ilə avtomatik seçin.</li>
            <li><strong>Hara:</strong> təyinat dayanacağını seçin.</li>
            <li><strong>Marşrutu tap:</strong> alət ən yaxşı marşrutu — avtobuslar, dəyişmələr, piyada keçidlər və təxmini vaxt — xəritədə və addım-addım göstərir.</li>
          </ol>

          <h2 className="text-xl font-bold text-gray-900">Məhdudiyyətlər</h2>
          <p className="text-gray-700">
            Bu alət marşrut <strong>topologiyasını</strong> (hansı avtobuslar, hansı ardıcıllıq) planlayır — <strong>cədvəl və ya real-vaxt</strong> gəliş saatlarını yox.
            Vaxtlar təxminidir. Məlumat Ayna açıq nəqliyyat məlumatlarına əsaslanır və dövri yenilənir; şəhərdə marşrut dəyişiklikləri ola bilər.
            İşə getmək üçün maaş və yol xərclərini hesablamaq istəsəniz, <Link href="/aletler/maas-kalkulyatoru" className="text-orange-600 hover:underline">maaş kalkulyatorumuza</Link> baxın.
          </p>

          <h2 className="text-xl font-bold text-gray-900">Tez-tez verilən suallar</h2>
          {FAQ.map(f => (
            <div key={f.q} className="mt-3">
              <h3 className="font-semibold text-gray-900">{f.q}</h3>
              <p className="text-gray-700">{f.a}</p>
            </div>
          ))}
        </section>

        <div className="mt-10"><RelatedTools currentSlug={tool.slug} /></div>
      </main>
    </>
  );
}
