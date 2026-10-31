import { Metadata } from 'next';
import Link from 'next/link';
import { Bus, ChevronDown, ChevronRight, Info } from 'lucide-react';
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
// The open study of the bus network (#694), linked by its DOI, never its repository: that
// URL carries a name (#449).
const STUDY_URL = 'https://doi.org/10.5281/zenodo.23604370';

export const metadata: Metadata = {
  title: { absolute: 'Bakı Avtobus Marşrutu və Metro — Marşrut Tap | BirJob' },
  description: tool.description, keywords: tool.keywords,
  alternates: { canonical: PAGE_URL },
  openGraph: { images: ['/opengraph-image'], title: 'Bakı avtobus və metro marşrut planlayıcısı', description: tool.description, url: PAGE_URL, type: 'website', locale: 'az_AZ' },
};

const FAQ = [
  { q: 'Bu alət necə işləyir?', a: 'Başlanğıc və təyinat dayanacağını seçirsiniz. Alət avtobus və metro ilə ən az minmə tələb edən marşrutu seçir: metro qatarına minmək də avtobusa minmək kimi bir minmə sayılır. Eyni sayda minmə olan variantlar arasında təxmini hərəkət vaxtı, sonra piyada məsafəsi müqayisə olunur. Bir avtobusla getmək mümkündürsə, daha sürətli olsa belə iki minməli variant (məsələn, avtobus və metro) onu əvəz etmir.' },
  { q: 'Konkret bir avtobusun bütün marşrutunu necə görə bilərəm?', a: '«Xətti göstər» rejiminə keçin və avtobus nömrəsini seçin (məsələn 88). Həmin xəttin bütün marşrutu — başlanğıc dayanacağından son dayanacağa qədər — xəritədə göstərilir, keçdiyi bütün dayanacaqların ardıcıl siyahısı, ümumi uzunluğu və təxmini vaxtı ilə birlikdə. İki istiqamətli xətlərdə «Gediş» və «Qayıdış» arasında keçə bilərsiniz.' },
  { q: 'Vaxt dəqiqdirmi?', a: 'Xeyr — bu, yalnız təxmini hərəkət vaxtıdır. Avtobusun və qatarın gözlənilməsi, cədvəl və tıxaclar nəzərə alınmır. Avtobus xəttinin ümumi müddəti dayanacaqlar arasındakı hissələrə bərabər bölünür; metro qatarının stansiyalar arası vaxtı Bakı Metropoliteninin öz marşrut planlayıcısındandır, stansiyada eskalatorla və keçidlərdə keçən vaxt isə daxil deyil; piyada vaxtı təxmini məsafədən hesablanır. Bu alət dəqiq gəliş saatı vermir.' },
  { q: 'Məlumat haradandır və nə qədər təzədir?', a: 'Avtobuslar AYNA açıq nəqliyyat məlumatlarından götürülmüş istinad bazasındandır və avtomatik yenilənmir. Şəhərdə avtobus xətləri dəyişmiş ola bilər. Metro məlumatı (qatar xidmətləri, vaxtlar və stansiya çıxışları) Bakı Metropoliteninin saytından və opendata.az-dan, stansiyaların yeri və xətlərin izi isə OpenStreetMap-dandır (© OpenStreetMap iştirakçıları); 25 oktyabr 2026-cı il vəziyyətini göstərir. O gün 28 May ilə Nizami arasında qatarlar işləmirdi və bu hissədə metronun ekspres avtobusları işləyirdi; Əhmədli ilə Həzi Aslanov arasında isə ayrıca məkik qatar işləyirdi. Səfərdən əvvəl cari marşrutu rəsmi mənbələrdən yoxlayın.' },
  { q: 'Niyə bəzən piyada keçid təklif olunur?', a: `Təyinat dayanacağı düz xətt üzrə ${WALK_METERS} metrədək məsafədədirsə, qısa piyada variantı göstərilir. Digər səfərlərdə başlanğıcda, sonda və minmələr arasında ən çox ${WALK_METERS} metrlik piyada keçid mümkündür; metro stansiyasına qədər məsafə stansiyanın ən yaxın çıxışına qədər ölçülür. Ardıcıl piyada keçidlər birləşdirilmir. Məsafə düz xətt üzrə təxmindir; real piyada yolunu və keçid imkanını xəritədə yoxlayın.` },
  { q: 'Velosiped zolaqları və parkinqləri göstərilirmi?', a: `Bəli. Xəritədə AYNA-nın velosiped zolaqları yaşıl nöqtələrlə çəkilir; xəritəni yaxınlaşdırdıqda velosiped parkinq məntəqələri də görünür. Xəritənin küncündəki «Velosiped zolaqları» seçimi ilə onları gizlədə bilərsiniz. Marşrutun ilk minmə və son düşmə yerinə ${WALK_METERS} metrədək məsafədə parkinq varsa, nəticədə onun kodu və düz xətt üzrə təxmini məsafəsi göstərilir: dayanacağa velosipedlə gəlib onu orada saxlaya bilərsiniz. Alət velosipedlə marşrut hesablamır və velosiped icarəsi haqqında məlumat vermir, çünki bu açıq məlumat yalnız zolaqların və parkinqlərin yerini göstərir. Məlumat opendata.az portalındandır: zolaqlar 24 sentyabr 2026-cı il, parkinq məntəqələri isə 4 may 2026-cı il tarixli fayllardandır.` },
];

export default async function Page() {
  const nonce = await getNonce();
  return (
    <>
      <JsonLd nonce={nonce} data={buildWebApplication({ name: 'Bakı avtobus və metro marşrut planlayıcısı', url: PAGE_URL, description: tool.description, category: 'UtilitiesApplication' })} />
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

        <header className="mb-5 sm:mb-7">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-orange-700"><Bus aria-hidden="true" className="h-4 w-4" />Bakı · Avtobus və metro</div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">Bakı avtobus marşrutu planlayıcısı</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-600 sm:text-base">Haradan hara gedirsiniz? Dayanacaqları seçin, avtobus və metro ilə daha az dəyişməli yolu xəritədə görün. Pulsuz və qeydiyyatsız.</p>
        </header>

        <Component />

        <section className="mt-10" aria-labelledby="planner-help">
          <h2 id="planner-help" className="text-xl font-bold text-gray-900">Marşrutu necə tapmaq olar?</h2>
          <ol className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              ['Başlanğıcı seçin', 'Dayanacağın adını və ya kodunu yazın, xəritədə seçin, yaxud yaxınınızdakı dayanacağı tapın.'],
              ['Təyinatı seçin', 'Getmək istədiyiniz dayanacağı seçin. Alət avtobus və metronu birlikdə nəzərə alır.'],
              ['Yolunuzu izləyin', 'Harada minəcəyinizi, neçə dayanacaq gedəcəyinizi və harada dəyişəcəyinizi addım-addım görün.'],
            ].map(([title, text], index) => (
              <li key={title} className="rounded-xl border border-gray-200 bg-white p-4">
                <span className="mb-2 flex h-6 w-6 items-center justify-center rounded-full bg-orange-50 text-xs font-bold text-orange-700" aria-hidden="true">{index + 1}</span>
                <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-gray-600">{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-7 grid gap-5 rounded-2xl border border-gray-200 bg-white p-5 sm:grid-cols-2 sm:p-6">
          <div>
            <h2 className="text-base font-bold text-gray-900">Hansı avtobus hara gedir?</h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-600"><strong>«Xətti göstər»</strong> rejimində avtobus nömrəsini (məsələn, 1, 65, 88 və ya H1) və ya son dayanacağın adını axtarın. Xəttin bütün dayanacaqlarını və marşrutunu xəritədə görün. Mövcud olduqda «Gediş» və «Qayıdış» istiqamətləri arasında keçin.</p>
            <p className="mt-3 text-sm leading-relaxed text-gray-600">İşə gediş üçün maaş və xərcləri planlayırsınız? <Link href="/aletler/maas-kalkulyatoru" className="font-medium text-orange-700 underline underline-offset-2">Maaş kalkulyatoruna</Link> da baxın.</p>
          </div>
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-gray-900"><Info aria-hidden="true" className="h-4 w-4 text-orange-600" />Məlumat və məhdudiyyətlər</h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">Bu alət canlı gəliş saatı göstərmir. Vaxta gözləmə, cədvəl, tıxac və metro daxilində keçidlər daxil deyil. Avtobus və piyada məsafələri düz xətt üzrə, metro məsafələri xətt boyunca hesablanır.</p>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">Avtobuslar <a href="https://ayna.gov.az/az" className="font-medium text-orange-700 underline underline-offset-2">AYNA</a> istinad bazasından, metro xidmətləri <a href="https://metro.gov.az/" className="font-medium text-orange-700 underline underline-offset-2">Bakı Metropoliteni</a> və opendata.az-dan götürülüb. Metro məlumatı 25 oktyabr 2026-cı il vəziyyətinə uyğundur. Bazalar avtomatik yenilənmir; səfərdən əvvəl cari xidməti yoxlayın.</p>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">Bakı avtobus şəbəkəsinin səmərəliliyi eyni AYNA xəritə məlumatı ilə <a href={STUDY_URL} className="font-medium text-orange-700 underline underline-offset-2">açıq tədqiqatda</a> ölçülüb; tədqiqatın kodu və məlumatları hər kəs üçün açıqdır.</p>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">Velosiped zolaqları (24 sentyabr 2026-cı il) və parkinq məntəqələri (4 may 2026-cı il) AYNA-nın <a href="https://opendata.az/@azerbaycan-yerustu-neqliyyat-agentliyi" className="font-medium text-orange-700 underline underline-offset-2">opendata.az</a> portalındakı açıq məlumatlarındandır. Alət velosipedlə marşrut hesablamır.</p>
            <p className="mt-2 text-xs text-gray-500">Metro xəritə məlumatı: <a href="https://www.openstreetmap.org/copyright" className="underline underline-offset-2">© OpenStreetMap iştirakçıları, ODbL</a>.</p>
          </div>
        </section>

        <section className="mt-8" aria-labelledby="planner-faq">
          <h2 id="planner-faq" className="mb-4 text-xl font-bold text-gray-900">Tez-tez verilən suallar</h2>
          <div className="divide-y divide-gray-200 overflow-hidden rounded-2xl border border-gray-200 bg-white">
            {FAQ.map(f => (
              <details key={f.q} className="group px-4 sm:px-5">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 py-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500 [&::-webkit-details-marker]:hidden">
                  <h3 className="text-sm font-semibold text-gray-900">{f.q}</h3><ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-gray-500 transition-transform group-open:rotate-180" />
                </summary>
                <p className="pb-5 text-sm leading-relaxed text-gray-600">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <div className="mt-10"><RelatedTools currentSlug={tool.slug} /></div>
      </section>
    </>
  );
}
