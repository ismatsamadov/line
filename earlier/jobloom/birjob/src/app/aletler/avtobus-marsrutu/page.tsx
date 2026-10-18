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
import { WALK_RADIUS_KM } from '@/lib/busroute/geo';

const tool = getToolBySlug('avtobus-marsrutu')!;
const PAGE_URL = `https://www.birjob.com/aletler/${tool.slug}`;
const WALK_METERS = Math.round(WALK_RADIUS_KM * 1000);

export const metadata: Metadata = {
  title: { absolute: 'Bakı Avtobus Marşrutu — Daha Az Dəyişmə ilə (Pulsuz) | BirJob' },
  description: tool.description, keywords: tool.keywords,
  alternates: { canonical: PAGE_URL },
  openGraph: { images: ['/opengraph-image'], title: tool.label, description: tool.description, url: PAGE_URL, type: 'website' },
};

const FAQ = [
  { q: 'Bu alət necə işləyir?', a: 'Başlanğıc və təyinat dayanacağını seçirsiniz. Alət əvvəlcə ən az avtobusa minmə tələb edən marşrutu seçir. Eyni sayda avtobus olan variantlar arasında təxmini hərəkət vaxtı, sonra piyada məsafəsi müqayisə olunur. Bir avtobusla getmək mümkündürsə, daha sürətli olsa belə iki avtobuslu variant onu əvəz etmir.' },
  { q: 'Konkret bir avtobusun bütün marşrutunu necə görə bilərəm?', a: '«Xətti göstər» rejiminə keçin və avtobus nömrəsini seçin (məsələn 88). Həmin xəttin bütün marşrutu — başlanğıc dayanacağından son dayanacağa qədər — xəritədə göstərilir, keçdiyi bütün dayanacaqların ardıcıl siyahısı, ümumi uzunluğu və təxmini vaxtı ilə birlikdə. İki istiqamətli xətlərdə «Gediş» və «Qayıdış» arasında keçə bilərsiniz.' },
  { q: 'Vaxt dəqiqdirmi?', a: 'Xeyr — bu, yalnız təxmini hərəkət vaxtıdır. Avtobusun gözlənilməsi, cədvəl və tıxaclar nəzərə alınmır. Avtobus xəttinin ümumi müddəti dayanacaqlar arasındakı hissələrə bərabər bölünür; piyada vaxtı isə təxmini məsafədən hesablanır. Bu alət dəqiq gəliş saatı vermir.' },
  { q: 'Məlumat haradandır və nə qədər təzədir?', a: 'AYNA açıq nəqliyyat məlumatlarından götürülmüş istinad bazasıdır və avtomatik yenilənmir. Şəhərdə avtobus xətləri dəyişmiş ola bilər. Səfərdən əvvəl cari marşrutu rəsmi mənbələrdən yoxlayın.' },
  { q: 'Niyə bəzən piyada keçid təklif olunur?', a: `Təyinat dayanacağı düz xətt üzrə ${WALK_METERS} metrədək məsafədədirsə, qısa piyada variantı göstərilir. Digər səfərlərdə başlanğıcda, sonda və avtobuslar arasında ən çox ${WALK_METERS} metrlik piyada keçid mümkündür. Ardıcıl piyada keçidlər birləşdirilmir. Məsafə düz xətt üzrə təxmindir; real piyada yolunu və keçid imkanını xəritədə yoxlayın.` },
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

      <section className="bj-tool-page bj-tool-page-wide mx-auto px-4 py-8">
        <nav className="mb-6 flex items-center gap-1 text-sm text-gray-500" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-orange-600">BirJob</Link><ChevronRight className="h-4 w-4" />
          <Link href="/aletler" className="hover:text-orange-600">Alətlər</Link><ChevronRight className="h-4 w-4" />
          <span className="text-gray-700">{tool.label}</span>
        </nav>

        <header className="bj-tool-heading mb-6">
          <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-orange-50 text-orange-600"><Bus className="h-6 w-6" /></div>
          <h1 className="text-2xl font-extrabold text-gray-900 sm:text-3xl">Bakı Avtobus Marşrutu Planlayıcısı</h1>
          <p className="mt-2 max-w-2xl text-gray-600">{tool.tagline}. Başlanğıc və təyinat dayanacağını seçin — hansı avtobuslara minəcəyinizi, dəyişmələri, piyada keçidlərini və təxmini vaxtı xəritədə görün. Yaxud <strong>«Xətti göstər»</strong> rejiminə keçib bir avtobus nömrəsi seçin — həmin xəttin bütün marşrutunu və dayanacaqlarını xəritədə izləyin.</p>
        </header>

        <Component />

        <section className="prose prose-gray mt-10 max-w-none">
          <h2 className="text-xl font-bold text-gray-900">Necə istifadə etməli?</h2>
          <ol className="text-gray-700">
            <li><strong>Haradan:</strong> başlanğıc dayanacağını adla axtarın, xəritədən toxunun, və ya «yaxınımdakı dayanacaqdan başla» düyməsi ilə avtomatik seçin.</li>
            <li><strong>Hara:</strong> təyinat dayanacağını seçin.</li>
            <li><strong>Marşrutu tap:</strong> alət ən az avtobusa minmə tələb edən marşrutu, keçidləri və təxmini hərəkət vaxtını addım-addım göstərir. {WALK_METERS} metrədək qısa səfərlər üçün piyada variantı göstərilə bilər.</li>
          </ol>

          <h2 className="text-xl font-bold text-gray-900">Bir avtobus xəttinin marşrutunu gör</h2>
          <p className="text-gray-700">
            Hansı avtobusun hara getdiyini bilmək istəyirsiniz? <strong>«Xətti göstər»</strong> rejiminə keçin və avtobus
            nömrəsini (məsələn 1, 65, 88, H1) və ya son dayanacağın adını yazın. Alət həmin xəttin <strong>bütün
            marşrutunu</strong> — başlanğıc dayanacağından son dayanacağa qədər — xəritədə çəkir və keçdiyi bütün
            dayanacaqları ardıcıllıqla sadalayır. Xəttin ümumi uzunluğunu (km) və bütün marşrutun təxmini müddətini
            (dəqiqə) də göstərir. İki istiqamətli xətlər üçün <strong>«Gediş»</strong> və <strong>«Qayıdış»</strong>
            istiqamətləri arasında keçid edə bilərsiniz.
          </p>

          <h2 className="text-xl font-bold text-gray-900">Məhdudiyyətlər</h2>
          <p className="text-gray-700">
            Bu alət marşrut <strong>topologiyasını</strong> (hansı avtobuslar, hansı ardıcıllıq) planlayır — <strong>cədvəl və ya real-vaxt</strong> gəliş saatlarını yox.
            Vaxt yalnız təxmini hərəkət müddətidir; gözləmə, cədvəl və tıxac daxil deyil. Məsafələr düz xətt üzrə hesablanır.
            AYNA məlumatlarından götürülmüş istinad bazası avtomatik yenilənmir; cari marşrutu və piyada keçid imkanını səfərdən əvvəl yoxlayın.
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
      </section>
    </>
  );
}
